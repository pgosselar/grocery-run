import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import type { IncomingMessage } from "node:http";

// One shared family passcode. Leave FAMILY_PASSCODE unset for no login (fine on a trusted home network).
const PASSCODE = process.env.FAMILY_PASSCODE ?? "";
const SECRET = process.env.SESSION_SECRET ?? PASSCODE + ":grocery-run";
const COOKIE = "gr_session";

export const authEnabled = PASSCODE.length > 0;

function sign(name: string) {
  const payload = Buffer.from(JSON.stringify({ name })).toString("base64url");
  const mac = createHmac("sha256", SECRET).update(payload).digest("base64url");
  return `${payload}.${mac}`;
}

function verify(token: string | undefined): { name: string } | null {
  if (!token) return null;
  const [payload, mac] = token.split(".");
  if (!payload || !mac) return null;
  const expected = createHmac("sha256", SECRET).update(payload).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString());
  } catch {
    return null;
  }
}

function readCookie(header: string | undefined): string | undefined {
  return header
    ?.split(";")
    .map((c) => c.trim().split("="))
    .find(([k]) => k === COOKIE)?.[1];
}

export function sessionFrom(req: IncomingMessage): { name: string } | null {
  const s = verify(readCookie(req.headers.cookie));
  if (s) return s;
  return authEnabled ? null : { name: "" };
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (sessionFrom(req)) return next();
  res.status(401).json({ error: "unauthorized" });
}

export function login(req: Request, res: Response) {
  const { passcode, name } = (req.body ?? {}) as { passcode?: string; name?: string };
  const ok =
    !authEnabled ||
    (typeof passcode === "string" &&
      passcode.length === PASSCODE.length &&
      timingSafeEqual(Buffer.from(passcode), Buffer.from(PASSCODE)));
  if (!ok) return res.status(401).json({ error: "Wrong passcode" });
  const cleanName = String(name ?? "").trim().slice(0, 40);
  res.cookie(COOKIE, sign(cleanName), {
    httpOnly: true,
    sameSite: "lax",
    secure: req.secure,
    maxAge: 1000 * 60 * 60 * 24 * 365,
  });
  res.json({ name: cleanName });
}

export function me(req: Request, res: Response) {
  const s = sessionFrom(req);
  res.json({ authEnabled, session: s });
}
