import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { InvitePreview, User } from "../shared/types.ts";
import { addMember, db, listById, roleOf, tx } from "./db.ts";

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1 };

interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string | null;
  google_sub: string | null;
  created_at: number;
  invited_by: string | null;
}

export function publicUser(u: UserRow): User {
  const user: User = { id: u.id, name: u.name, email: u.email, hasPassword: !!u.password_hash, hasGoogle: !!u.google_sub };
  if (isAdmin(u)) user.admin = true;
  return user;
}

// ---------- admin ----------

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
const firstUser = db.prepare("SELECT id FROM users ORDER BY created_at, rowid LIMIT 1");

/** Whoever's in ADMIN_EMAILS, or without it, the first account made on this server. */
export function isAdmin(u: { id: string; email: string }): boolean {
  if (ADMIN_EMAILS.length) return ADMIN_EMAILS.includes(u.email);
  return (firstUser.get() as { id: string } | undefined)?.id === u.id;
}

// ---------- passwords ----------

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function checkPassword(password: string, stored: string | null): Promise<boolean> {
  // Burn the same time for unknown emails so response timing doesn't reveal who has an account.
  const parts = (stored ?? `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${randomBytes(16).toString("base64")}$`).split("$");
  const [, N, r, p, salt, hash] = parts;
  const key = await scryptAsync(password, Buffer.from(salt, "base64"), 64, { N: +N, r: +r, p: +p });
  const expected = Buffer.from(hash ?? "", "base64");
  return !!stored && expected.length === key.length && timingSafeEqual(expected, key);
}

export const MIN_PASSWORD = 8;

// ---------- users ----------

const byId = db.prepare("SELECT * FROM users WHERE id = ?");
const byEmail = db.prepare("SELECT * FROM users WHERE email = ?");
const byGoogle = db.prepare("SELECT * FROM users WHERE google_sub = ?");
const countUsers = db.prepare("SELECT COUNT(*) AS n FROM users");
const insertUser = db.prepare(
  "INSERT INTO users(id, email, name, password_hash, google_sub, created_at, invited_by) VALUES(?, ?, ?, ?, ?, ?, ?)",
);
const setName = db.prepare("UPDATE users SET name = ? WHERE id = ?");
const setPasswordHash = db.prepare("UPDATE users SET password_hash = ? WHERE id = ?");
const setGoogle = db.prepare("UPDATE users SET google_sub = ? WHERE id = ?");
const allUsers = db.prepare("SELECT * FROM users ORDER BY created_at");

export const normalizeEmail = (e: string) => e.trim().toLowerCase();

export function userById(id: string) {
  return byId.get(id) as UserRow | undefined;
}
export function userByEmail(email: string) {
  return byEmail.get(normalizeEmail(email)) as UserRow | undefined;
}
export function userByGoogle(sub: string) {
  return byGoogle.get(sub) as UserRow | undefined;
}
export function listUsers() {
  return allUsers.all() as unknown as UserRow[];
}
export function userCount() {
  return (countUsers.get() as { n: number }).n;
}

export function createUser(input: { email: string; name: string; passwordHash?: string; googleSub?: string; invitedBy?: string }): UserRow {
  const id = randomUUID();
  insertUser.run(
    id,
    normalizeEmail(input.email),
    input.name.trim().slice(0, 40),
    input.passwordHash ?? null,
    input.googleSub ?? null,
    Date.now(),
    input.invitedBy ?? null,
  );
  return userById(id)!;
}

/**
 * Makes an account if sign-up is allowed right now, and uses up the app invite it came with, all at once
 * so two people can't both sign up on one single-use link. Null when sign-up isn't allowed.
 */
export function signUpWith(
  invite: string | null,
  input: { email: string; name: string; passwordHash?: string; googleSub?: string },
): UserRow | null {
  return tx(() => {
    if (!signupAllowed(invite)) return null;
    const by = invite ? (inviteByToken(invite)?.created_by ?? appInviteByToken(invite)?.created_by) : undefined;
    const user = createUser({ ...input, invitedBy: by });
    if (invite) claimAppInvite.run(user.id, Date.now(), invite, Date.now());
    return user;
  });
}

export function renameUser(id: string, name: string) {
  setName.run(name.trim().slice(0, 40), id);
}
export function setPassword(id: string, hash: string) {
  setPasswordHash.run(hash, id);
}
export function clearPassword(id: string) {
  setPasswordHash.run(null, id);
}
export function linkGoogle(id: string, sub: string) {
  setGoogle.run(sub, id);
}

/**
 * New accounts: the very first one is free (that's you setting up the server); after that you need an
 * invite link (to a list, or an unused one to the app), unless SIGNUPS=open.
 */
export function signupAllowed(inviteToken?: string | null): boolean {
  if (process.env.SIGNUPS === "open") return true;
  if (userCount() === 0) return true;
  return !!(inviteToken && (inviteByToken(inviteToken) || appInviteByToken(inviteToken)));
}

// ---------- sessions ----------

const SESSION_DAYS = 400;
const insertSession = db.prepare("INSERT INTO sessions(token_hash, user_id, created_at, last_seen) VALUES(?, ?, ?, ?)");
const sessionUser = db.prepare(`
  SELECT u.*, s.last_seen FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?
`);
const touchSession = db.prepare("UPDATE sessions SET last_seen = ? WHERE token_hash = ?");
const deleteSession = db.prepare("DELETE FROM sessions WHERE token_hash = ?");
const deleteUserSessions = db.prepare("DELETE FROM sessions WHERE user_id = ?");
const expireSessions = db.prepare("DELETE FROM sessions WHERE last_seen < ?");

const sha = (t: string) => createHash("sha256").update(t).digest("base64url");

export function createSession(userId: string): string {
  const token = randomBytes(32).toString("base64url");
  const t = Date.now();
  insertSession.run(sha(token), userId, t, t);
  return token;
}

export function sessionLookup(token: string | undefined): UserRow | null {
  if (!token) return null;
  const h = sha(token);
  const row = sessionUser.get(h) as (UserRow & { last_seen: number }) | undefined;
  if (!row) return null;
  const t = Date.now();
  if (t - row.last_seen > SESSION_DAYS * 864e5) {
    deleteSession.run(h);
    return null;
  }
  // Sliding expiry; write at most hourly.
  if (t - row.last_seen > 36e5) touchSession.run(t, h);
  return row;
}

export function endSession(token: string | undefined) {
  if (token) deleteSession.run(sha(token));
}
export function endAllSessions(userId: string) {
  deleteUserSessions.run(userId);
}
export const SESSION_MAX_AGE = SESSION_DAYS * 864e5;

setInterval(() => expireSessions.run(Date.now() - SESSION_MAX_AGE), 864e5).unref();

// ---------- invites ----------

const INVITE_DAYS = 14;
const insertInvite = db.prepare(
  "INSERT INTO invites(token, list_id, created_by, created_at, expires_at) VALUES(?, ?, ?, ?, ?)",
);
const inviteRow = db.prepare("SELECT * FROM invites WHERE token = ? AND expires_at > ?");
const activeInvite = db.prepare(
  "SELECT * FROM invites WHERE list_id = ? AND expires_at > ? ORDER BY created_at DESC LIMIT 1",
);
const revokeInvites = db.prepare("DELETE FROM invites WHERE list_id = ?");

interface InviteRow {
  token: string;
  list_id: string;
  created_by: string;
  created_at: number;
  expires_at: number;
}

function inviteByToken(token: string) {
  if (typeof token !== "string" || token.length > 100) return undefined;
  const row = inviteRow.get(token, Date.now()) as InviteRow | undefined;
  return row && listById(row.list_id) ? row : undefined;
}

/** The list's current invite link, made fresh if there isn't one (or `reset`). */
export function inviteFor(listId: string, userId: string, reset = false): { token: string; expiresAt: number } {
  return tx(() => {
    if (reset) revokeInvites.run(listId);
    const cur = activeInvite.get(listId, Date.now() + 864e5) as InviteRow | undefined; // ≥1 day left
    if (cur) return { token: cur.token, expiresAt: cur.expires_at };
    const token = randomBytes(18).toString("base64url");
    const t = Date.now();
    const expiresAt = t + INVITE_DAYS * 864e5;
    insertInvite.run(token, listId, userId, t, expiresAt);
    return { token, expiresAt };
  });
}

export function previewInvite(token: string): InvitePreview | null {
  const app = appInviteByToken(token);
  if (app) {
    return { invitedBy: userById(app.created_by)?.name ?? "Someone", name: app.name, email: app.email ?? undefined };
  }
  const inv = inviteByToken(token);
  if (!inv) return null;
  const list = listById(inv.list_id)!;
  return {
    listName: list.name,
    invitedBy: userById(inv.created_by)?.name ?? "Someone",
    color: list.color,
    icon: list.icon,
  };
}

const joinListeners = new Set<(listId: string) => void>();
/** Called whenever someone new joins a list (however they signed in), so others can be told live. */
export function onJoin(fn: (listId: string) => void) {
  joinListeners.add(fn);
}

/** Join the list behind an invite. Returns the list id, or null if the link is no good. */
export function acceptInvite(token: string, userId: string): string | null {
  const inv = inviteByToken(token);
  if (!inv) return null;
  if (!roleOf(inv.list_id, userId)) {
    addMember(inv.list_id, userId, "member");
    joinListeners.forEach((fn) => fn(inv.list_id));
  }
  return inv.list_id;
}

// ---------- app invites (from the admin screen) ----------

export interface AppInviteRow {
  token: string;
  name: string;
  email: string | null;
  created_by: string;
  created_at: number;
  expires_at: number;
  used_by: string | null;
  used_at: number | null;
}

const insertAppInvite = db.prepare(
  "INSERT INTO app_invites(token, name, email, created_by, created_at, expires_at) VALUES(?, ?, ?, ?, ?, ?)",
);
const appInviteRow = db.prepare("SELECT * FROM app_invites WHERE token = ? AND used_by IS NULL AND expires_at > ?");
const claimAppInvite = db.prepare(
  "UPDATE app_invites SET used_by = ?, used_at = ? WHERE token = ? AND used_by IS NULL AND expires_at > ?",
);
const allAppInvites = db.prepare("SELECT * FROM app_invites ORDER BY created_at DESC");
const deleteAppInvite = db.prepare("DELETE FROM app_invites WHERE token = ? AND used_by IS NULL");

/** An app invite that can still be used */
function appInviteByToken(token: string) {
  if (typeof token !== "string" || token.length > 100) return undefined;
  return appInviteRow.get(token, Date.now()) as AppInviteRow | undefined;
}

export function createAppInvite(createdBy: string, name: string, email: string | null): AppInviteRow {
  const token = randomBytes(18).toString("base64url");
  const t = Date.now();
  insertAppInvite.run(token, name.trim().slice(0, 40), email ? normalizeEmail(email) : null, createdBy, t, t + INVITE_DAYS * 864e5);
  return appInviteRow.get(token, t) as unknown as AppInviteRow;
}

export function listAppInvites() {
  return allAppInvites.all() as unknown as AppInviteRow[];
}

/** Only unused invites can be revoked; used ones stay as a record of who invited whom. */
export function revokeAppInvite(token: string): boolean {
  return Number(deleteAppInvite.run(token).changes) > 0;
}

// ---------- password resets ----------

const RESET_MINUTES = 60;
const insertReset = db.prepare("INSERT INTO password_resets(token_hash, user_id, expires_at) VALUES(?, ?, ?)");
const resetRow = db.prepare("SELECT user_id FROM password_resets WHERE token_hash = ? AND expires_at > ?");
const clearResets = db.prepare("DELETE FROM password_resets WHERE user_id = ? OR expires_at < ?");

export function createResetToken(userId: string): string {
  const token = randomBytes(32).toString("base64url");
  insertReset.run(sha(token), userId, Date.now() + RESET_MINUTES * 60_000);
  return token;
}

/** Uses up a reset link: returns whose it was, or null if it's expired or already used. */
export function consumeResetToken(token: string): string | null {
  if (typeof token !== "string" || token.length > 100) return null;
  const row = resetRow.get(sha(token), Date.now()) as { user_id: string } | undefined;
  if (!row) return null;
  clearResets.run(row.user_id, Date.now());
  return row.user_id;
}
