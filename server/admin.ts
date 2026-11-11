// The admin screen: everyone's accounts, invites to the app, and how much it's being used.
// Counts only: nothing here shows what's on anyone's lists.
import { randomBytes } from "node:crypto";
import { statSync } from "node:fs";
import type { NextFunction, Request, Response } from "express";
import type { AdminInvite, AdminOverview, AdminUser } from "../shared/types.ts";
import { backupHealth } from "./backup.ts";
import { db } from "./db.ts";
import { emailEnabled, escapeHtml, sendEmail } from "./mail.ts";
import { BACKUP_MIRROR_DIR, DB_PATH } from "./paths.ts";
import { currentUser, origin, sendResetEmail, userFrom } from "./auth.ts";
import {
  type AppInviteRow, createAppInvite, endAllSessions, hashPassword, isAdmin, listAppInvites, listUsers, normalizeEmail,
  revokeAppInvite, setPassword, userByEmail, userById,
} from "./users.ts";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const WEEK = 7 * 864e5;

/** Not found, rather than forbidden, so the admin screen doesn't advertise itself. */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const user = userFrom(req);
  if (!user?.admin) return res.status(404).json({ error: "Not found" });
  res.locals.user = user;
  next();
}

// ---------- numbers ----------

const perUser = db.prepare(`
  SELECT u.id,
    (SELECT MAX(last_seen) FROM sessions s WHERE s.user_id = u.id) AS last_seen,
    (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id) AS devices,
    (SELECT COUNT(*) FROM members m JOIN lists l ON l.id = m.list_id AND l.deleted = 0
      WHERE m.user_id = u.id AND m.role = 'owner') AS owned,
    (SELECT COUNT(*) FROM members m JOIN lists l ON l.id = m.list_id AND l.deleted = 0
      WHERE m.user_id = u.id AND m.role = 'member') AS shared,
    (SELECT COUNT(*) FROM recipes r WHERE r.created_by = u.id) AS recipes,
    (SELECT COUNT(*) FROM recipe_photos p WHERE p.added_by = u.id) AS photos
  FROM users u
`);
// Items from before ids were recorded only have a name, so those are matched by name.
const addedCounts = db.prepare(`
  SELECT json_extract(data, '$.addedById') AS uid, json_extract(data, '$.addedBy') AS name,
    COUNT(*) AS n, SUM(json_extract(data, '$.createdAt') > ?) AS week
  FROM items WHERE data != '{}' GROUP BY uid, name
`);
const checkedCounts = db.prepare(`
  SELECT json_extract(data, '$.completedById') AS uid, json_extract(data, '$.completedBy') AS name,
    COUNT(*) AS n, SUM(completed_at > ?) AS week
  FROM completions GROUP BY uid, name
`);
const totalsQuery = db.prepare(`
  SELECT
    (SELECT COUNT(*) FROM lists WHERE deleted = 0) AS lists,
    (SELECT COUNT(*) FROM items i JOIN lists l ON l.id = i.list_id AND l.deleted = 0
      WHERE i.deleted = 0 AND json_extract(i.data, '$.completed') = 0) AS open_items,
    (SELECT COUNT(*) FROM items WHERE data != '{}' AND json_extract(data, '$.createdAt') > ?) AS added_week,
    (SELECT COUNT(*) FROM completions WHERE completed_at > ?) AS checked_week,
    (SELECT COUNT(*) FROM recipes) AS recipes,
    (SELECT COUNT(*) FROM recipe_photos) AS photos
`);

interface CountRow { uid: string | null; name: string | null; n: number; week: number | null }

/** Tally counts per user id, falling back to a unique name for old rows that lack an id. */
function tally(rows: CountRow[], users: { id: string; name: string }[]) {
  const byName = new Map<string, string | null>();
  for (const u of users) byName.set(u.name, byName.has(u.name) ? null : u.id);
  const out = new Map<string, { n: number; week: number }>();
  for (const r of rows) {
    const id = r.uid ?? (r.name ? byName.get(r.name) : null);
    if (!id) continue;
    const t = out.get(id) ?? { n: 0, week: 0 };
    t.n += r.n;
    t.week += r.week ?? 0;
    out.set(id, t);
  }
  return out;
}

const fileSize = (p: string) => {
  try {
    return statSync(p).size;
  } catch {
    return 0;
  }
};

function inviteView(req: Request, inv: AppInviteRow): AdminInvite {
  const used = inv.used_by ? userById(inv.used_by) : undefined;
  return {
    token: inv.token,
    url: `${origin(req)}/#/invite/${inv.token}`,
    name: inv.name,
    email: inv.email,
    createdBy: userById(inv.created_by)?.name ?? "Someone",
    createdAt: inv.created_at,
    expiresAt: inv.expires_at,
    usedBy: inv.used_by ? { id: inv.used_by, name: used?.name ?? "(account deleted)" } : null,
    usedAt: inv.used_at,
  };
}

export function overview(req: Request, res: Response) {
  const now = Date.now();
  const since = now - WEEK;
  const rows = listUsers();
  const extra = new Map(
    (perUser.all() as { id: string; last_seen: number | null; devices: number; owned: number; shared: number; recipes: number; photos: number }[])
      .map((r) => [r.id, r]),
  );
  const added = tally(addedCounts.all(since) as unknown as CountRow[], rows);
  const checked = tally(checkedCounts.all(since) as unknown as CountRow[], rows);

  const users: AdminUser[] = rows.map((u) => {
    const x = extra.get(u.id)!;
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      signIn: [...(u.password_hash ? ["password" as const] : []), ...(u.google_sub ? ["google" as const] : [])],
      admin: isAdmin(u),
      joinedAt: u.created_at,
      invitedBy: u.invited_by ? (userById(u.invited_by)?.name ?? null) : null,
      lastActive: x.last_seen,
      devices: x.devices,
      listsOwned: x.owned,
      listsShared: x.shared,
      itemsAdded: added.get(u.id)?.n ?? 0,
      itemsAddedWeek: added.get(u.id)?.week ?? 0,
      checkedOff: checked.get(u.id)?.n ?? 0,
      checkedOffWeek: checked.get(u.id)?.week ?? 0,
      recipes: x.recipes,
      photos: x.photos,
    };
  });

  const t = totalsQuery.get(since, since) as Record<string, number>;
  const health = backupHealth();
  const body: AdminOverview = {
    users,
    invites: listAppInvites().map((i) => inviteView(req, i)),
    totals: {
      users: users.length,
      activeWeek: users.filter((u) => u.lastActive && u.lastActive > since).length,
      lists: t.lists,
      openItems: t.open_items,
      itemsAddedWeek: t.added_week,
      checkedOffWeek: t.checked_week,
      recipes: t.recipes,
      photos: t.photos,
    },
    server: {
      email: emailEnabled,
      dbBytes: fileSize(DB_PATH) + fileSize(`${DB_PATH}-wal`),
      backups: { ...health, mirror: !!BACKUP_MIRROR_DIR },
    },
  };
  res.json(body);
}

// ---------- invites ----------

const dateText = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "long", day: "numeric" });

export async function inviteSomeone(req: Request, res: Response) {
  const me = currentUser(res);
  const { name, email, send } = (req.body ?? {}) as Record<string, unknown>;
  if (typeof name !== "string" || !name.trim()) return res.status(400).json({ error: "Enter who it's for" });
  const addr = typeof email === "string" && email.trim() ? email.trim() : null;
  if (addr && !EMAIL_RE.test(addr)) return res.status(400).json({ error: "That email doesn't look right" });
  if (addr && userByEmail(addr)) return res.status(409).json({ error: "There's already an account with that email." });
  if (send && !addr) return res.status(400).json({ error: "Enter their email to send the invite" });
  if (send && !emailEnabled) return res.status(400).json({ error: "Email isn't set up on this server. Share the link instead." });

  const invite = inviteView(req, createAppInvite(me.id, name, addr));
  if (send && addr) {
    const first = invite.name.split(/\s+/)[0];
    const text =
      `Hi ${first},\n\n${me.name} invited you to Grocery Run, our family's shared grocery lists.\n\n` +
      `Open this link to make your account (it works until ${dateText(invite.expiresAt)}):\n${invite.url}\n\n` +
      `On an iPhone, open it in Safari, then tap Share and Add to Home Screen to keep it handy.`;
    const html =
      `<p>Hi ${escapeHtml(first)},</p><p>${escapeHtml(me.name)} invited you to Grocery Run, our family's shared grocery lists.</p>` +
      `<p><a href="${escapeHtml(invite.url)}">Make my account</a> (the link works until ${dateText(invite.expiresAt)})</p>` +
      `<p>On an iPhone, open it in Safari, then tap Share and <b>Add to Home Screen</b> to keep it handy.</p>`;
    try {
      await sendEmail(normalizeEmail(addr), `${me.name} invited you to Grocery Run`, text, html);
    } catch (err) {
      console.error("Invite email failed:", err instanceof Error ? err.message : err);
      return res.json({ invite, emailError: "The invite is made, but the email didn't send. Share the link instead." });
    }
  }
  res.json({ invite });
}

export function revokeInvite(req: Request, res: Response) {
  if (!revokeAppInvite(String(req.params.token))) return res.status(404).json({ error: "That invite was already used or removed" });
  res.json({ ok: true });
}

// ---------- helping someone sign in ----------

function target(req: Request, res: Response) {
  const user = userById(String(req.params.id));
  if (!user) {
    res.status(404).json({ error: "No such account" });
    return null;
  }
  if (user.id === currentUser(res).id) {
    res.status(400).json({ error: "That's your own account. Use the Account screen for that." });
    return null;
  }
  return user;
}

/** A password to read out to them; they're signed out everywhere until they use it. */
export async function tempPassword(req: Request, res: Response) {
  const user = target(req, res);
  if (!user) return;
  const password = randomBytes(6).toString("base64url");
  setPassword(user.id, await hashPassword(password));
  endAllSessions(user.id);
  res.json({ password });
}

export async function emailReset(req: Request, res: Response) {
  const user = target(req, res);
  if (!user) return;
  if (!emailEnabled) return res.status(400).json({ error: "Email isn't set up on this server" });
  try {
    await sendResetEmail(req, user);
  } catch (err) {
    console.error("Password reset email failed:", err instanceof Error ? err.message : err);
    return res.status(502).json({ error: "The email didn't send. Try a temporary password instead." });
  }
  res.json({ ok: true });
}

/** Returns the user signed out, so the caller can close their live connections too. */
export function signOutEverywhere(req: Request, res: Response): string | null {
  const user = target(req, res);
  if (!user) return null;
  endAllSessions(user.id);
  res.json({ ok: true });
  return user.id;
}
