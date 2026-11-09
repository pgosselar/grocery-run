import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DB_PATH } from "./paths.ts";
import type { GroceryList, HistoryEntry, Item, Member, Op, Snapshot } from "../shared/types.ts";
import { defaultSections, resolveSection } from "../shared/sections.ts";

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS lists (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,
    list_id TEXT NOT NULL,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS items_list ON items(list_id);
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS completions (
    item_id TEXT NOT NULL,
    list_id TEXT NOT NULL,
    section TEXT NOT NULL,
    completed_at INTEGER NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (item_id, completed_at)
  );
  CREATE INDEX IF NOT EXISTS completions_list ON completions(list_id, section, completed_at DESC);

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT,
    google_sub TEXT UNIQUE,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    last_seen INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
  CREATE TABLE IF NOT EXISTS members (
    list_id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    joined_at INTEGER NOT NULL,
    PRIMARY KEY (list_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS members_user ON members(user_id);
  CREATE TABLE IF NOT EXISTS invites (
    token TEXT PRIMARY KEY,
    list_id TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS invites_list ON invites(list_id);
  CREATE TABLE IF NOT EXISTS password_resets (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );

  -- The recipe box. A recipe is visible to whoever saved it and to everyone on a list it's tagged with.
  CREATE TABLE IF NOT EXISTS recipes (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    url TEXT,
    created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS recipes_url ON recipes(url);
  CREATE INDEX IF NOT EXISTS recipes_creator ON recipes(created_by);
  CREATE TABLE IF NOT EXISTS recipe_lists (
    recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    list_id TEXT NOT NULL,
    added_by TEXT NOT NULL,
    added_at INTEGER NOT NULL,
    PRIMARY KEY (recipe_id, list_id)
  );
  CREATE INDEX IF NOT EXISTS recipe_lists_list ON recipe_lists(list_id);
  -- A photo someone took of the finished dish. In the database, so the nightly backups include it.
  CREATE TABLE IF NOT EXISTS recipe_photos (
    recipe_id TEXT PRIMARY KEY REFERENCES recipes(id) ON DELETE CASCADE,
    full BLOB NOT NULL,
    thumb BLOB NOT NULL,
    added_by TEXT NOT NULL,
    added_at INTEGER NOT NULL
  );
  CREATE VIRTUAL TABLE IF NOT EXISTS recipes_fts USING fts5(
    id UNINDEXED, title, ingredients, body, tokenize = "porter unicode61 remove_diacritics 2"
  );
`);

export function tx<T>(fn: () => T): T {
  db.exec("BEGIN");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

const getMeta = db.prepare("SELECT value FROM meta WHERE key = ?");
const setMeta = db.prepare(
  "INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
);
export function meta(key: string): string | undefined {
  return (getMeta.get(key) as { value: string } | undefined)?.value;
}
export function setMetaValue(key: string, value: string) {
  setMeta.run(key, value);
}
export function version(): number {
  return Number(meta("version") ?? 0);
}

// ---------- membership ----------

const memberRole = db.prepare("SELECT role FROM members WHERE list_id = ? AND user_id = ?");
const listMembers = db.prepare(`
  SELECT m.list_id, m.user_id, m.role, u.name FROM members m JOIN users u ON u.id = m.user_id
  WHERE m.list_id = ? ORDER BY m.role = 'owner' DESC, m.joined_at
`);
const insertMember = db.prepare(`
  INSERT INTO members(list_id, user_id, role, position, joined_at) VALUES(?, ?, ?, ?, ?)
  ON CONFLICT(list_id, user_id) DO NOTHING
`);
const nextPosition = db.prepare("SELECT COALESCE(MAX(position) + 1, 0) AS p FROM members WHERE user_id = ?");
const deleteMember = db.prepare("DELETE FROM members WHERE list_id = ? AND user_id = ?");
const deleteMembers = db.prepare("DELETE FROM members WHERE list_id = ?");
const setPosition = db.prepare("UPDATE members SET position = ? WHERE list_id = ? AND user_id = ?");

export function roleOf(listId: string, userId: string): "owner" | "member" | null {
  return ((memberRole.get(listId, userId) as { role: string } | undefined)?.role as "owner" | "member") ?? null;
}

export function membersOf(listId: string): Member[] {
  return (listMembers.all(listId) as { user_id: string; role: string; name: string }[]).map((r) => ({
    userId: r.user_id,
    name: r.name,
    role: r.role as Member["role"],
  }));
}

export function memberIds(listId: string): string[] {
  return membersOf(listId).map((m) => m.userId);
}

export function addMember(listId: string, userId: string, role: Member["role"]) {
  const { p } = nextPosition.get(userId) as { p: number };
  insertMember.run(listId, userId, role, p, Date.now());
}

export function removeMember(listId: string, userId: string) {
  deleteMember.run(listId, userId);
}

// ---------- validation ----------

const MAX_LIST_BYTES = 128_000;
const MAX_ITEM_BYTES = 16_000;

function str(v: unknown, max: number) {
  return typeof v === "string" ? v.slice(0, max) : "";
}

/** Keep whatever a client sends to a sane shape and size. */
function cleanList(l: GroceryList): GroceryList | null {
  if (!l || typeof l.id !== "string" || !l.id || typeof l.updatedAt !== "number") return null;
  const sections = Array.isArray(l.sections) && l.sections.length
    ? l.sections.slice(0, 80).map((s) => ({
        id: str(s?.id, 64) || "other",
        name: str(s?.name, 60).trim() || "Untitled",
        keywords: Array.isArray(s?.keywords)
          ? [...new Set(s.keywords.map((k) => str(k, 80).toLowerCase()).filter((k) => k.trim()))].slice(0, 1000)
          : [],
      }))
    : defaultSections();
  const out: GroceryList = {
    id: l.id.slice(0, 64),
    name: str(l.name, 100).trim() || "Untitled",
    color: l.color,
    icon: str(l.icon, 40),
    position: Number(l.position) || 0,
    grouped: l.grouped !== false,
    sections,
    createdAt: Number(l.createdAt) || l.updatedAt,
    updatedAt: l.updatedAt,
  };
  return JSON.stringify(out).length <= MAX_LIST_BYTES ? out : null;
}

function validItem(i: Item) {
  return (
    i && typeof i.id === "string" && i.id && typeof i.listId === "string" && typeof i.updatedAt === "number" &&
    typeof i.title === "string" && JSON.stringify(i).length <= MAX_ITEM_BYTES
  );
}

// ---------- ops ----------

// Last-write-wins upserts. Deletes are tombstones so an offline client
// can't resurrect a deleted row with a stale edit.
const upsertList = db.prepare(`
  INSERT INTO lists(id, data, updated_at) VALUES(?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
  WHERE lists.deleted = 0 AND excluded.updated_at >= lists.updated_at
`);
const deleteList = db.prepare(`
  INSERT INTO lists(id, data, updated_at, deleted) VALUES(?, '{}', ?, 1)
  ON CONFLICT(id) DO UPDATE SET deleted = 1, updated_at = excluded.updated_at
`);
const deleteListItems = db.prepare("UPDATE items SET deleted = 1, updated_at = ? WHERE list_id = ?");
const untagRecipes = db.prepare("DELETE FROM recipe_lists WHERE list_id = ?");
const deleteListInvites = db.prepare("DELETE FROM invites WHERE list_id = ?");
const upsertItem = db.prepare(`
  INSERT INTO items(id, list_id, data, updated_at) VALUES(?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET data = excluded.data, list_id = excluded.list_id, updated_at = excluded.updated_at
  WHERE items.deleted = 0 AND excluded.updated_at >= items.updated_at
`);
const deleteItem = db.prepare(`
  INSERT INTO items(id, list_id, data, updated_at, deleted) VALUES(?, '', '{}', ?, 1)
  ON CONFLICT(id) DO UPDATE SET deleted = 1, updated_at = excluded.updated_at
`);
const getList = db.prepare("SELECT data, deleted FROM lists WHERE id = ?");
const getItem = db.prepare("SELECT list_id, data, deleted FROM items WHERE id = ?");
const insertCompletion = db.prepare(
  "INSERT OR REPLACE INTO completions(item_id, list_id, section, completed_at, data) VALUES(?, ?, ?, ?, ?)",
);
const removeCompletion = db.prepare("DELETE FROM completions WHERE item_id = ? AND completed_at = ?");

function logCompletion(item: Item) {
  const at = item.completedAt ?? item.updatedAt;
  const entry: HistoryEntry = {
    itemId: item.id,
    listId: item.listId,
    title: item.title,
    quantity: item.quantity,
    section: item.section,
    addedBy: item.addedBy,
    createdAt: item.createdAt,
    completedBy: item.completedBy ?? "",
    completedAt: at,
  };
  insertCompletion.run(item.id, item.listId, item.section, at, JSON.stringify(entry));
}

/** Keep the check-off log in step with an item change that was just applied. */
function trackCompletion(prev: Item | null, next: Item) {
  if (next.completed && !prev?.completed) logCompletion(next);
  else if (!next.completed && prev?.completed && prev.completedAt) {
    // Unchecked (often a mis-tap): drop that check-off from history.
    removeCompletion.run(prev.id, prev.completedAt);
  }
}

export interface Actor {
  id: string;
  name: string;
}

/** Who should hear about an applied op. */
export interface Delivery {
  op: Op;
  userIds: string[];
  /** Users who lost sight of something (item moved to a list they're not on) and should refetch */
  refresh?: string[];
}

/**
 * Applies one user's ops in a transaction. Ops on lists the user isn't a member of are dropped,
 * as are deletes of lists they don't own.
 */
export function applyOps(actor: Actor, ops: Op[]): { deliveries: Delivery[]; rejected: number; version: number } {
  const deliveries: Delivery[] = [];
  let rejected = 0;
  const can = (listId: string) => roleOf(listId, actor.id) !== null;

  return tx(() => {
    for (const op of ops) {
      switch (op.type) {
        case "list.put": {
          const list = cleanList(op.list);
          if (!list) { rejected++; break; }
          const existing = getList.get(list.id) as { deleted: number } | undefined;
          if (existing && !can(list.id)) { rejected++; break; }
          if (Number(upsertList.run(list.id, JSON.stringify(list), list.updatedAt).changes) === 0) break;
          if (!existing) addMember(list.id, actor.id, "owner");
          deliveries.push({ op: { type: "list.put", list }, userIds: memberIds(list.id) });
          break;
        }
        case "list.delete": {
          if (roleOf(op.id, actor.id) !== "owner") { rejected++; break; }
          const audience = memberIds(op.id);
          deleteList.run(op.id, op.at);
          deleteListItems.run(op.at, op.id);
          deleteMembers.run(op.id);
          deleteListInvites.run(op.id);
          untagRecipes.run(op.id);
          deliveries.push({ op, userIds: audience });
          break;
        }
        case "item.put": {
          const item = op.item;
          if (!validItem(item) || !can(item.listId)) { rejected++; break; }
          const parent = getList.get(item.listId) as { data: string; deleted: number } | undefined;
          if (!parent || parent.deleted) break;
          const prevRow = getItem.get(item.id) as { list_id: string; data: string; deleted: number } | undefined;
          if (prevRow?.deleted) break;
          const prev = prevRow ? (JSON.parse(prevRow.data) as Item) : null;
          if (prev && prev.listId !== item.listId && !can(prev.listId)) { rejected++; break; }

          // Who added / completed it comes from the session, not the client.
          const next: Item = {
            ...item,
            addedBy: prev ? prev.addedBy : actor.name,
            addedById: prev ? prev.addedById : actor.id,
            createdAt: prev ? prev.createdAt : item.createdAt,
          };
          if (next.completed && !prev?.completed) {
            next.completedBy = actor.name;
            next.completedById = actor.id;
          } else if (next.completed && prev?.completed) {
            next.completedBy = prev.completedBy;
            next.completedById = prev.completedById;
          } else if (!next.completed) {
            next.completedBy = "";
            next.completedById = undefined;
          }
          const sections = (JSON.parse(parent.data) as GroceryList).sections ?? [];
          if (sections.length) next.section = resolveSection(sections, String(next.section ?? ""));

          if (Number(upsertItem.run(next.id, next.listId, JSON.stringify(next), next.updatedAt).changes) === 0) break;
          trackCompletion(prev, next);
          const audience = memberIds(next.listId);
          const lostSight =
            prev && prev.listId !== next.listId ? memberIds(prev.listId).filter((u) => !audience.includes(u)) : [];
          deliveries.push({ op: { type: "item.put", item: next }, userIds: audience, refresh: lostSight });
          break;
        }
        case "item.delete": {
          const row = getItem.get(op.id) as { list_id: string; deleted: number } | undefined;
          if (row && (row.deleted || !can(row.list_id))) { if (!row.deleted) rejected++; break; }
          if (Number(deleteItem.run(op.id, op.at).changes) === 0) break;
          deliveries.push({ op, userIds: row ? memberIds(row.list_id) : [actor.id] });
          break;
        }
        case "list.order": {
          if (!Array.isArray(op.ids)) { rejected++; break; }
          op.ids.slice(0, 500).forEach((id, i) => setPosition.run(i, String(id), actor.id));
          deliveries.push({ op, userIds: [actor.id] });
          break;
        }
        default:
          rejected++;
      }
    }
    const changed = deliveries.length > 0;
    const v = version() + (changed ? 1 : 0);
    if (changed) setMeta.run("version", String(v));
    return { deliveries, rejected, version: v };
  });
}

const userLists = db.prepare(`
  SELECT l.data, m.position FROM members m JOIN lists l ON l.id = m.list_id
  WHERE m.user_id = ? AND l.deleted = 0
`);
const listItems = db.prepare("SELECT data FROM items WHERE list_id = ? AND deleted = 0");

/**
 * Words added to the standard sections after lists were created. Each list keeps its own copy of its
 * words, so give existing lists these once, and only where none of that list's sections has the word yet.
 */
const ADDED_KEYWORDS: { key: string; words: Record<string, string[]> }[] = [
  { key: "keywords.2026-11-chickpeas", words: { pantry: ["chickpea", "garbanzo"], produce: ["snap pea", "snow pea"] } },
];
for (const { key, words } of ADDED_KEYWORDS) {
  if (meta(key)) continue;
  tx(() => {
    const rows = db.prepare("SELECT id, data FROM lists WHERE deleted = 0").all() as { id: string; data: string }[];
    const now = Date.now();
    let changed = 0;
    for (const row of rows) {
      const list = JSON.parse(row.data) as GroceryList;
      if (!Array.isArray(list.sections)) continue;
      const has = new Set(list.sections.flatMap((s) => s.keywords.map((k) => k.trim())));
      let touched = false;
      list.sections = list.sections.map((s) => {
        const add = (words[s.id] ?? []).filter((w) => !has.has(w));
        if (!add.length) return s;
        touched = true;
        return { ...s, keywords: [...s.keywords, ...add] };
      });
      if (!touched) continue;
      list.updatedAt = now;
      upsertList.run(row.id, JSON.stringify(list), now);
      changed++;
    }
    setMetaValue(key, String(now));
    if (changed) setMetaValue("version", String(version() + 1));
  });
}

export function snapshot(userId: string): Snapshot {
  const lists = (userLists.all(userId) as { data: string; position: number }[]).map((r) => ({
    ...(JSON.parse(r.data) as GroceryList),
    position: r.position,
  }));
  const items: Item[] = [];
  const members: Record<string, Member[]> = {};
  for (const l of lists) {
    for (const r of listItems.all(l.id) as { data: string }[]) items.push(JSON.parse(r.data) as Item);
    members[l.id] = membersOf(l.id);
  }
  return { lists, items, members, version: version() };
}

export function listById(id: string): GroceryList | null {
  const row = getList.get(id) as { data: string; deleted: number } | undefined;
  return row && !row.deleted ? (JSON.parse(row.data) as GroceryList) : null;
}

const historyAll = db.prepare(
  "SELECT data FROM completions WHERE list_id = ? ORDER BY completed_at DESC LIMIT ?",
);
const historySection = db.prepare(
  "SELECT data FROM completions WHERE list_id = ? AND section = ? ORDER BY completed_at DESC LIMIT ?",
);
const historySections = db.prepare("SELECT DISTINCT section FROM completions WHERE list_id = ?");

export function history(listId: string, section: string | null, limit: number) {
  const rows = (section === null
    ? historyAll.all(listId, limit)
    : historySection.all(listId, section, limit)) as { data: string }[];
  return {
    entries: rows.map((r) => JSON.parse(r.data) as HistoryEntry),
    sections: (historySections.all(listId) as { section: string }[]).map((r) => r.section),
  };
}
