import { dirname, join } from "node:path";

export const DB_PATH = process.env.DB_PATH ?? "data/grocery.db";
/** Nightly copies of the database. Kept next to it unless told otherwise. */
export const BACKUP_DIR = process.env.BACKUP_DIR ?? join(dirname(DB_PATH), "backups");
/** Optional second home for each backup, ideally on another machine (a NAS share, a synced folder). */
export const BACKUP_MIRROR_DIR = process.env.BACKUP_MIRROR_DIR || undefined;
/** The running server touches this so a restore can tell it's still up. */
export const HEARTBEAT_PATH = join(dirname(DB_PATH), ".server-heartbeat");
