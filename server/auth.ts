import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { claudeEnabled } from "./recipe/claude.ts";
import type { NextFunction, Request, Response } from "express";
import type { IncomingMessage } from "node:http";
import type { AuthInfo, User } from "../shared/types.ts";
import { meta, setMetaValue } from "./db.ts";
import { emailEnabled, escapeHtml, sendEmail } from "./mail.ts";
import {
  MIN_PASSWORD, SESSION_MAX_AGE, acceptInvite, checkPassword, createSession, endSession, hashPassword,
  linkGoogle, normalizeEmail, publicUser, sessionLookup, setPassword, signupAllowed, userByEmail, userByGoogle,
  userById, renameUser, endAllSessions, clearPassword, userCount, createResetToken, consumeResetToken, signUpWith,
} from "./users.ts";

const COOKIE = "gr_sid";
const OAUTH_COOKIE = "gr_oauth";

const GOOGLE_ID = process.env.GOOGLE_CLIENT_ID ?? "";
const GOOGLE_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? "";
export const googleEnabled = !!(GOOGLE_ID && GOOGLE_SECRET);

// Signs the short-lived OAuth state cookie. Kept in the database so it survives restarts.
const SECRET =
  process.env.SESSION_SECRET ||
  meta("secret") ||
  (() => {
    const s = randomBytes(32).toString("base64url");
    setMetaValue("secret", s);
    return s;
  })();

// ---------- cookies ----------

function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of header?.split(";") ?? []) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

function setSessionCookie(req: Request, res: Response, token: string) {
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: req.secure, maxAge: SESSION_MAX_AGE, path: "/" });
}

function startSession(req: Request, res: Response, userId: string) {
  setSessionCookie(req, res, createSession(userId));
}

export function userFrom(req: IncomingMessage): User | null {
  const row = sessionLookup(readCookie(req.headers.cookie, COOKIE));
  return row ? publicUser(row) : null;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = userFrom(req);
  if (!user) return res.status(401).json({ error: "Please sign in" });
  res.locals.user = user;
  next();
}

export const currentUser = (res: Response) => res.locals.user as User;

// ---------- rate limiting ----------

const attempts = new Map<string, { n: number; reset: number }>();
const WINDOW = 15 * 60_000;
const MAX_ATTEMPTS = 20;

function limited(key: string): boolean {
  const t = Date.now();
  const a = attempts.get(key);
  if (!a || a.reset < t) {
    attempts.set(key, { n: 1, reset: t + WINDOW });
    return false;
  }
  a.n++;
  return a.n > MAX_ATTEMPTS;
}
setInterval(() => {
  const t = Date.now();
  for (const [k, a] of attempts) if (a.reset < t) attempts.delete(k);
}, WINDOW).unref();

// ---------- handlers ----------

export function me(req: Request, res: Response) {
  const invite = typeof req.query.invite === "string" ? req.query.invite : null;
  const info: AuthInfo = {
    user: userFrom(req),
    google: googleEnabled,
    signupOpen: signupAllowed(invite),
    firstRun: userCount() === 0,
    email: emailEnabled,
    recipePhotos: claudeEnabled,
  };
  res.json(info);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function signup(req: Request, res: Response) {
  const { email, password, name, invite } = (req.body ?? {}) as Record<string, unknown>;
  if (limited(`signup:${req.ip}`)) return res.status(429).json({ error: "Too many tries. Wait a few minutes." });
  if (typeof email !== "string" || !EMAIL_RE.test(email.trim())) return res.status(400).json({ error: "Enter a valid email" });
  if (typeof name !== "string" || !name.trim()) return res.status(400).json({ error: "Enter your name" });
  if (typeof password !== "string" || password.length < MIN_PASSWORD) {
    return res.status(400).json({ error: `Use at least ${MIN_PASSWORD} characters for the password` });
  }
  const inviteToken = typeof invite === "string" ? invite : null;
  if (!signupAllowed(inviteToken)) {
    return res.status(403).json({
      error: inviteToken
        ? "That invite link has already been used or has expired. Ask for a new one."
        : "New accounts need an invite link. Ask someone to share a list with you.",
    });
  }
  if (userByEmail(email)) return res.status(409).json({ error: "There's already an account with that email. Sign in instead." });

  const passwordHash = await hashPassword(password);
  // Checked again: a single-use invite may have been used while the password was hashing.
  if (userByEmail(email)) return res.status(409).json({ error: "There's already an account with that email. Sign in instead." });
  const user = signUpWith(inviteToken, { email, name, passwordHash });
  if (!user) return res.status(403).json({ error: "That invite link has already been used or has expired. Ask for a new one." });
  startSession(req, res, user.id);
  const listId = inviteToken ? acceptInvite(inviteToken, user.id) : null;
  res.json({ user: publicUser(user), listId });
}

export async function login(req: Request, res: Response) {
  const { email, password, invite } = (req.body ?? {}) as Record<string, unknown>;
  if (typeof email !== "string" || typeof password !== "string") return res.status(400).json({ error: "Enter your email and password" });
  if (limited(`login:${req.ip}`) || limited(`login:${normalizeEmail(email)}`)) {
    return res.status(429).json({ error: "Too many tries. Wait a few minutes." });
  }
  const row = userByEmail(email);
  const ok = await checkPassword(password, row?.password_hash ?? null);
  if (!row || !ok) {
    const hint = row && !row.password_hash && row.google_sub ? " This account uses Continue with Google." : "";
    return res.status(401).json({ error: `Wrong email or password.${hint}` });
  }
  startSession(req, res, row.id);
  const listId = typeof invite === "string" ? acceptInvite(invite, row.id) : null;
  res.json({ user: publicUser(row), listId });
}

export function logout(req: Request, res: Response) {
  endSession(readCookie(req.headers.cookie, COOKIE));
  res.clearCookie(COOKIE, { path: "/" });
  res.json({ ok: true });
}

export async function updateAccount(req: Request, res: Response) {
  const user = currentUser(res);
  const { name, currentPassword, newPassword } = (req.body ?? {}) as Record<string, unknown>;
  if (typeof name === "string") {
    if (!name.trim()) return res.status(400).json({ error: "Enter your name" });
    renameUser(user.id, name);
  }
  if (typeof newPassword === "string") {
    if (newPassword.length < MIN_PASSWORD) return res.status(400).json({ error: `Use at least ${MIN_PASSWORD} characters` });
    const row = userById(user.id)!;
    if (row.password_hash && !(await checkPassword(String(currentPassword ?? ""), row.password_hash))) {
      return res.status(401).json({ error: "Current password is wrong" });
    }
    setPassword(user.id, await hashPassword(newPassword));
    // Sign out other phones, keep this one.
    endAllSessions(user.id);
    startSession(req, res, user.id);
  }
  res.json({ user: publicUser(userById(user.id)!) });
}

/** Always answers the same way, so it can't be used to find out who has an account. */
export async function forgotPassword(req: Request, res: Response) {
  const { email } = (req.body ?? {}) as Record<string, unknown>;
  if (!emailEnabled) return res.status(400).json({ error: "Email isn't set up on this server. Ask whoever runs it to reset your password." });
  if (typeof email !== "string" || !EMAIL_RE.test(email.trim())) return res.status(400).json({ error: "Enter a valid email" });
  if (limited(`forgot:${req.ip}`) || limited(`forgot:${normalizeEmail(email)}`)) {
    return res.status(429).json({ error: "Too many tries. Wait a few minutes." });
  }
  res.json({ ok: true });
  const user = userByEmail(email);
  if (!user) return;
  try {
    await sendResetEmail(req, user);
  } catch (err) {
    console.error("Password reset email failed:", err instanceof Error ? err.message : err);
  }
}

export async function sendResetEmail(req: Request, user: { id: string; email: string; name: string }) {
  const link = `${origin(req)}/#/reset/${createResetToken(user.id)}`;
  await sendEmail(
    user.email,
    "Reset your Grocery Run password",
    `Hi ${user.name},\n\nTo choose a new password, open this link within an hour:\n${link}\n\nIf you didn't ask for this, ignore this email.`,
    `<p>Hi ${escapeHtml(user.name)},</p><p>To choose a new password, open this link within an hour:</p>` +
      `<p><a href="${escapeHtml(link)}">Reset my password</a></p><p>If you didn't ask for this, ignore this email.</p>`,
  );
}

export async function resetPassword(req: Request, res: Response) {
  const { token, password } = (req.body ?? {}) as Record<string, unknown>;
  if (typeof password !== "string" || password.length < MIN_PASSWORD) {
    return res.status(400).json({ error: `Use at least ${MIN_PASSWORD} characters for the password` });
  }
  if (limited(`reset:${req.ip}`)) return res.status(429).json({ error: "Too many tries. Wait a few minutes." });
  const userId = consumeResetToken(String(token ?? ""));
  if (!userId) return res.status(400).json({ error: "That reset link has expired or was already used. Ask for a new one." });
  setPassword(userId, await hashPassword(password));
  endAllSessions(userId);
  startSession(req, res, userId);
  res.json({ user: publicUser(userById(userId)!), listId: null });
}

// ---------- Google (OpenID Connect, authorization code + PKCE) ----------

const b64url = (b: Buffer) => b.toString("base64url");

function signState(data: object) {
  const payload = b64url(Buffer.from(JSON.stringify(data)));
  return `${payload}.${createHmac("sha256", SECRET).update(payload).digest("base64url")}`;
}

function readState(value: string | undefined): Record<string, string> | null {
  const [payload, mac] = value?.split(".") ?? [];
  if (!payload || !mac) return null;
  const expected = Buffer.from(createHmac("sha256", SECRET).update(payload).digest("base64url"));
  const got = Buffer.from(mac);
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    return data.exp > Date.now() ? data : null;
  } catch {
    return null;
  }
}

export function origin(req: Request) {
  return (process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
}

const redirectUri = (req: Request) => `${origin(req)}/api/auth/google/callback`;

export function googleStart(req: Request, res: Response) {
  if (!googleEnabled) return res.status(404).send("Google sign-in isn't set up on this server.");
  const state = b64url(randomBytes(16));
  const nonce = b64url(randomBytes(16));
  const verifier = b64url(randomBytes(32));
  const invite = typeof req.query.invite === "string" ? req.query.invite.slice(0, 100) : "";
  res.cookie(OAUTH_COOKIE, signState({ state, nonce, verifier, invite, exp: Date.now() + 10 * 60_000 }), {
    httpOnly: true,
    sameSite: "lax",
    secure: req.secure,
    maxAge: 10 * 60_000,
    path: "/api/auth/google",
  });
  const params = new URLSearchParams({
    client_id: GOOGLE_ID,
    redirect_uri: redirectUri(req),
    response_type: "code",
    scope: "openid email profile",
    state,
    nonce,
    code_challenge: b64url(createHash("sha256").update(verifier).digest()),
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}

export interface GoogleIdentity {
  sub: string;
  email: string;
  name: string;
}

/** Trades the code for an ID token. It comes straight from Google over TLS, so we check its claims, not its signature. */
export async function exchangeGoogleCode(code: string, verifier: string, nonce: string, redirect: string): Promise<GoogleIdentity> {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_ID,
      client_secret: GOOGLE_SECRET,
      redirect_uri: redirect,
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await r.json().catch(() => ({}))) as { id_token?: string; error?: string };
  if (!r.ok || !body.id_token) throw new Error(`token exchange failed: ${body.error ?? r.status}`);
  const claims = JSON.parse(Buffer.from(body.id_token.split(".")[1] ?? "", "base64url").toString()) as Record<string, unknown>;
  if (!["https://accounts.google.com", "accounts.google.com"].includes(String(claims.iss))) throw new Error("bad issuer");
  if (claims.aud !== GOOGLE_ID) throw new Error("bad audience");
  if (typeof claims.exp !== "number" || claims.exp * 1000 < Date.now()) throw new Error("expired token");
  if (claims.nonce !== nonce) throw new Error("bad nonce");
  if (claims.email_verified !== true || typeof claims.email !== "string") throw new Error("email not verified");
  return {
    sub: String(claims.sub),
    email: claims.email,
    name: typeof claims.name === "string" && claims.name ? claims.name : claims.email.split("@")[0],
  };
}

export async function googleCallback(req: Request, res: Response) {
  const fail = (msg: string) => res.redirect(`/?auth_error=${encodeURIComponent(msg)}`);
  const saved = readState(readCookie(req.headers.cookie, OAUTH_COOKIE));
  res.clearCookie(OAUTH_COOKIE, { path: "/api/auth/google" });
  if (typeof req.query.error === "string") return fail("Google sign-in was cancelled.");
  if (!saved || saved.state !== req.query.state || typeof req.query.code !== "string") {
    return fail("That sign-in link expired. Try again.");
  }

  let id: GoogleIdentity;
  try {
    id = await exchangeGoogleCode(req.query.code, saved.verifier, saved.nonce, redirectUri(req));
  } catch (err) {
    console.error("Google sign-in failed:", err instanceof Error ? err.message : err);
    return fail("Google sign-in didn't work. Try again.");
  }

  let user = userByGoogle(id.sub);
  if (!user) {
    const byEmail = userByEmail(id.email);
    if (byEmail) {
      // Same verified email as an existing account: connect Google to it. Emails on password accounts
      // aren't verified, so drop that password and its sessions in case someone else registered this email.
      linkGoogle(byEmail.id, id.sub);
      if (byEmail.password_hash) {
        clearPassword(byEmail.id);
        endAllSessions(byEmail.id);
      }
      user = byEmail;
    } else {
      const created = signUpWith(saved.invite || null, { email: id.email, name: id.name, googleSub: id.sub });
      if (!created) {
        return fail(saved.invite ? "That invite link has already been used or has expired. Ask for a new one." : "New accounts need an invite link. Ask someone to share a list with you.");
      }
      user = created;
    }
  }
  startSession(req, res, user.id);
  const listId = saved.invite ? acceptInvite(saved.invite, user.id) : null;
  res.redirect(listId ? `/#/list/${listId}` : "/");
}
