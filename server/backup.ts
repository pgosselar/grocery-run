// Nightly copies of the database, so a dead disk or a bad mistake costs a day at most.
//
// Copies are made with SQLite's backup API. Copying the file directly while the server runs can catch it
// halfway through a write. Each copy is checked, switched to a single self-contained file (no -wal),
// then renamed into place, so a file named grocery-<date>.db is always complete.
//
// Kept: the 14 newest nightlies, plus the newest of each week going back 8 weeks.
import { backup, DatabaseSync } from "node:sqlite";
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { access, copyFile, readdir, rename, rm, stat } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";
import { BACKUP_DIR, BACKUP_MIRROR_DIR, DB_PATH, HEARTBEAT_PATH } from "./paths.ts";

const DAILY = /^grocery-(\d{4}-\d{2}-\d{2})\.db$/;
const PRE_RESTORE = /^pre-restore-.+\.db$/;
/** Put this file in the second folder to show it's the real one. */
export const MIRROR_MARKER = ".grocery-run-backups";
const KEEP_DAILY = 14;
const KEEP_WEEKS = 8;
const KEEP_PRE_RESTORE = 5;
/** Older than this and the health check fails. A day plus some slack for a late check. */
const STALE_HOURS = 30;

export interface BackupFile {
  name: string;
  path: string;
  date: string; // YYYY-MM-DD, or "" for a pre-restore copy
  bytes: number;
  modified: number;
}

const status: { lastOk?: number; error?: string; mirrorError?: string; mirrorPending?: boolean } = {
  // A fresh start checks the second folder once, in case it was set up after today's backup.
  mirrorPending: !!BACKUP_MIRROR_DIR,
};

/** Local calendar date. The container runs in UTC unless TZ is set. */
function today(now = new Date()) {
  return now.toLocaleDateString("sv-SE"); // sv-SE formats as YYYY-MM-DD
}

export function listBackups(dir = BACKUP_DIR): BackupFile[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => DAILY.test(n) || PRE_RESTORE.test(n))
    .map((name) => {
      const path = join(dir, name);
      const st = statSync(path);
      return { name, path, date: DAILY.exec(name)?.[1] ?? "", bytes: st.size, modified: st.mtimeMs };
    })
    .sort((a, b) => b.modified - a.modified);
}

/** "ok", or what's wrong with the file. */
function check(path: string): string {
  try {
    const copy = new DatabaseSync(path, { readOnly: true });
    try {
      const rows = copy.prepare("PRAGMA integrity_check").all() as { integrity_check: string }[];
      const result = rows.map((r) => r.integrity_check).join("; ");
      if (result !== "ok") return result;
      const hasLists = copy.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'lists'").get();
      return hasLists ? "ok" : "not a Grocery Run database";
    } finally {
      copy.close();
    }
  } catch (e) {
    return (e as Error).message;
  }
}

/** Copy `source` to `dest` safely: write beside it, check it, then rename into place. */
async function copyDatabase(source: DatabaseSync, dest: string) {
  const partial = `${dest}.partial`;
  rmSync(partial, { force: true });
  try {
    await backup(source, partial);
    // The copy inherits WAL mode. Switch it back so the backup stays a single file.
    const copy = new DatabaseSync(partial);
    copy.exec("PRAGMA journal_mode = DELETE");
    copy.close();
    const result = check(partial);
    if (result !== "ok") throw new Error(`backup failed its check: ${result}`);
    renameSync(partial, dest);
  } finally {
    for (const f of [partial, `${partial}-wal`, `${partial}-shm`]) rmSync(f, { force: true });
  }
}

/** Which backups to delete: all but the 14 newest nightlies, the newest of each recent week and a few pre-restores. */
function expired(all: { name: string; date: string; modified: number }[], now: number): string[] {
  const keep = new Set<string>();
  const daily = all.filter((b) => b.date).sort((a, b) => b.date.localeCompare(a.date));
  for (const b of daily.slice(0, KEEP_DAILY)) keep.add(b.name);
  const weeks = new Set<string>();
  for (const b of daily) {
    const d = new Date(`${b.date}T12:00:00Z`);
    if (now - d.getTime() > KEEP_WEEKS * 7 * 86_400_000) break;
    const monday = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
    if (!weeks.has(monday)) {
      weeks.add(monday);
      keep.add(b.name); // the newest backup of each week, since they're sorted newest first
    }
  }
  const preRestore = all.filter((b) => !b.date).sort((a, b) => b.modified - a.modified);
  for (const b of preRestore.slice(0, KEEP_PRE_RESTORE)) keep.add(b.name);
  return all.filter((b) => !keep.has(b.name)).map((b) => b.name);
}

function prune(dir: string, now: number) {
  for (const name of expired(listBackups(dir), now)) rmSync(join(dir, name), { force: true });
}

/**
 * Copy a finished backup to the second folder. Async, because that folder is usually a network share and a
 * slow or missing share mustn't stall the app. The folder must hold a marker file: if the share isn't
 * mounted, its empty mount point is still a folder, and writing there would quietly put the "off-machine"
 * copies on this disk.
 */
async function mirror(file: string, name: string, now: number) {
  const dir = BACKUP_MIRROR_DIR!;
  await access(join(dir, MIRROR_MARKER)).catch(() => {
    throw new Error(`no ${MIRROR_MARKER} file there (is the share mounted?)`);
  });
  const tmp = join(dir, `${name}.partial`);
  await copyFile(file, tmp);
  await rename(tmp, join(dir, name));
  const names = (await readdir(dir)).filter((n) => DAILY.test(n) || PRE_RESTORE.test(n));
  const files = await Promise.all(
    names.map(async (n) => ({ name: n, date: DAILY.exec(n)?.[1] ?? "", modified: (await stat(join(dir, n))).mtimeMs })),
  );
  for (const n of expired(files, now)) await rm(join(dir, n), { force: true });
}

/** Back up now. Today's backup is replaced if there already is one. */
export async function takeBackup(source: DatabaseSync, now = new Date()): Promise<BackupFile> {
  mkdirSync(BACKUP_DIR, { recursive: true });
  const name = `grocery-${today(now)}.db`;
  const dest = join(BACKUP_DIR, name);
  try {
    await copyDatabase(source, dest);
    prune(BACKUP_DIR, now.getTime());
    status.lastOk = Date.now();
    status.error = undefined;
  } catch (e) {
    status.error = (e as Error).message;
    throw e;
  }
  if (BACKUP_MIRROR_DIR) {
    try {
      await mirror(dest, name, now.getTime());
      status.mirrorError = undefined;
      status.mirrorPending = false;
    } catch (e) {
      status.mirrorError = (e as Error).message;
      console.error(`backup: saved here but not copied to ${BACKUP_MIRROR_DIR}: ${status.mirrorError}`);
    }
  }
  return listBackups().find((b) => b.name === name)!;
}

/** Whether backups are working, for the health check. */
export function backupHealth() {
  const newest = listBackups().find((b) => b.date);
  const ageHours = newest ? (Date.now() - newest.modified) / 3_600_000 : undefined;
  const problems: string[] = [];
  if (status.error) problems.push(`last backup failed: ${status.error}`);
  if (status.mirrorError) problems.push(`copy to ${BACKUP_MIRROR_DIR} failed: ${status.mirrorError}`);
  if (ageHours === undefined) problems.push("no backups yet");
  else if (ageHours > STALE_HOURS) problems.push(`newest backup is ${Math.round(ageHours)} hours old`);
  return { ok: problems.length === 0, lastBackup: newest ? new Date(newest.modified).toISOString() : null, problems };
}

/** Back up on start if today has no backup yet, then check every hour. Also keeps the heartbeat fresh. */
export function startBackups(source: DatabaseSync) {
  let running = false;
  const run = () => {
    const name = `grocery-${today()}.db`;
    const done = existsSync(join(BACKUP_DIR, name)) && !status.mirrorPending;
    if (running || (done && !status.error && !status.mirrorError)) return;
    running = true; // a stalled network share can outlast the hour
    takeBackup(source)
      .then((b) => console.log(`backup: saved ${b.name} (${Math.round(b.bytes / 1024)} KB)`))
      .catch((e: Error) => console.error(`backup: FAILED: ${e.message}`))
      .finally(() => (running = false));
  };
  const beat = () => {
    try {
      writeFileSync(HEARTBEAT_PATH, String(Date.now()));
    } catch {
      // not worth failing over
    }
  };
  beat();
  setInterval(beat, 30_000).unref();
  setTimeout(run, 5_000).unref();
  setInterval(run, 3_600_000).unref();
}

/** The server touched its heartbeat in the last 90 seconds. */
export function serverLooksRunning() {
  try {
    return Date.now() - statSync(HEARTBEAT_PATH).mtimeMs < 90_000;
  } catch {
    return false;
  }
}

/** Find a backup by file name (in the backup or mirror folder) or by path. */
export function findBackup(nameOrPath: string): string | undefined {
  const candidates = isAbsolute(nameOrPath) || nameOrPath.includes("/")
    ? [nameOrPath]
    : [BACKUP_DIR, BACKUP_MIRROR_DIR].filter(Boolean).map((d) => join(d!, basename(nameOrPath)));
  return candidates.find((p) => existsSync(p));
}

/**
 * Put a backup in place of the live database. The server must be stopped. The current database is kept
 * first as pre-restore-<time>.db, so a restore can be undone the same way.
 */
export async function restoreBackup(path: string): Promise<{ savedAs?: string }> {
  const result = check(path);
  if (result !== "ok") throw new Error(`${basename(path)} can't be restored: ${result}`);
  let savedAs: string | undefined;
  if (existsSync(DB_PATH)) {
    mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, "");
    for (let n = 1; !savedAs || existsSync(savedAs); n++) {
      savedAs = join(BACKUP_DIR, `pre-restore-${stamp}${n > 1 ? `-${n}` : ""}.db`);
    }
    const live = new DatabaseSync(DB_PATH);
    try {
      await copyDatabase(live, savedAs);
    } finally {
      live.close();
    }
  }
  const incoming = `${DB_PATH}.restoring`;
  copyFileSync(path, incoming);
  for (const f of [`${DB_PATH}-wal`, `${DB_PATH}-shm`]) rmSync(f, { force: true });
  renameSync(incoming, DB_PATH);
  return { savedAs };
}
