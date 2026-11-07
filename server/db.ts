import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { GroceryList, HistoryEntry, Item, Op, Snapshot } from "../shared/types.ts";

const DB_PATH = process.env.DB_PATH ?? "data/grocery.db";
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
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
`);

const getVersion = db.prepare("SELECT value FROM meta WHERE key = 'version'");
const setVersion = db.prepare(
  "INSERT INTO meta(key, value) VALUES('version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
);
export function version(): number {
  const row = getVersion.get() as { value: string } | undefined;
  return row ? Number(row.value) : 0;
}

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
const upsertItem = db.prepare(`
  INSERT INTO items(id, list_id, data, updated_at) VALUES(?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET data = excluded.data, list_id = excluded.list_id, updated_at = excluded.updated_at
  WHERE items.deleted = 0 AND excluded.updated_at >= items.updated_at
`);
const deleteItem = db.prepare(`
  INSERT INTO items(id, list_id, data, updated_at, deleted) VALUES(?, '', '{}', ?, 1)
  ON CONFLICT(id) DO UPDATE SET deleted = 1, updated_at = excluded.updated_at
`);
const listDeleted = db.prepare("SELECT deleted FROM lists WHERE id = ?");
const getItem = db.prepare("SELECT data, deleted FROM items WHERE id = ?");
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

/** Applies ops in one transaction; returns the ops that actually changed something. */
export function applyOps(ops: Op[]): { applied: Op[]; version: number } {
  const applied: Op[] = [];
  db.exec("BEGIN");
  try {
    for (const op of ops) {
      let changes = 0;
      switch (op.type) {
        case "list.put":
          changes = Number(upsertList.run(op.list.id, JSON.stringify(op.list), op.list.updatedAt).changes);
          break;
        case "list.delete":
          changes = Number(deleteList.run(op.id, op.at).changes);
          deleteListItems.run(op.at, op.id);
          break;
        case "item.put": {
          const parent = listDeleted.get(op.item.listId) as { deleted: number } | undefined;
          if (parent?.deleted) break;
          const prevRow = getItem.get(op.item.id) as { data: string; deleted: number } | undefined;
          const prev = prevRow && !prevRow.deleted ? (JSON.parse(prevRow.data) as Item) : null;
          changes = Number(
            upsertItem.run(op.item.id, op.item.listId, JSON.stringify(op.item), op.item.updatedAt).changes,
          );
          if (changes > 0) trackCompletion(prev, op.item);
          break;
        }
        case "item.delete":
          changes = Number(deleteItem.run(op.id, op.at).changes);
          break;
      }
      if (changes > 0) applied.push(op);
    }
    const v = version() + (applied.length ? 1 : 0);
    if (applied.length) setVersion.run(String(v));
    db.exec("COMMIT");
    return { applied, version: v };
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

const allLists = db.prepare("SELECT data FROM lists WHERE deleted = 0");
const allItems = db.prepare("SELECT data FROM items WHERE deleted = 0");

export function snapshot(): Snapshot {
  return {
    lists: (allLists.all() as { data: string }[]).map((r) => JSON.parse(r.data) as GroceryList),
    items: (allItems.all() as { data: string }[]).map((r) => JSON.parse(r.data) as Item),
    version: version(),
  };
}

const historyAll = db.prepare(
  "SELECT data FROM completions WHERE list_id = ? ORDER BY completed_at DESC LIMIT ?",
);
const historySection = db.prepare(
  "SELECT data FROM completions WHERE list_id = ? AND section = ? ORDER BY completed_at DESC LIMIT ?",
);
const historySections = db.prepare(
  "SELECT DISTINCT section FROM completions WHERE list_id = ?",
);

export function history(listId: string, section: string | null, limit: number) {
  const rows = (section === null
    ? historyAll.all(listId, limit)
    : historySection.all(listId, section, limit)) as { data: string }[];
  return {
    entries: rows.map((r) => JSON.parse(r.data) as HistoryEntry),
    sections: (historySections.all(listId) as { section: string }[]).map((r) => r.section),
  };
}

// One-time backfill: items already checked off before the log existed.
for (const row of db.prepare("SELECT data FROM items WHERE deleted = 0").all() as { data: string }[]) {
  const item = JSON.parse(row.data) as Item;
  if (item.completed) {
    db.prepare("INSERT OR IGNORE INTO completions(item_id, list_id, section, completed_at, data) VALUES(?, ?, ?, ?, ?)")
      .run(item.id, item.listId, item.section, item.completedAt ?? item.updatedAt, JSON.stringify({
        itemId: item.id, listId: item.listId, title: item.title, quantity: item.quantity, section: item.section,
        addedBy: item.addedBy, createdAt: item.createdAt, completedBy: item.completedBy ?? "",
        completedAt: item.completedAt ?? item.updatedAt,
      } satisfies HistoryEntry));
  }
}
