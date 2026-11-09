// Admin tasks on the server, since there's no email for password resets.
//   docker compose exec grocery-run node server/cli.ts users
//   docker compose exec grocery-run node server/cli.ts reset-password someone@example.com
//   docker compose exec grocery-run node server/cli.ts backups
//   docker compose exec grocery-run node server/cli.ts backup
//   docker compose stop && docker compose run --rm grocery-run node server/cli.ts restore grocery-2026-11-08.db
//
// Modules that open the database are imported only by the commands that need them, so `restore` never
// holds the file it's replacing.
import { randomBytes } from "node:crypto";

const [cmd, arg, flag] = process.argv.slice(2);
const usage = `Usage: node server/cli.ts <command>
  users                       list accounts
  reset-password <email>      print a temporary password
  backups                     list backups and whether they're healthy
  backup                      back up now (safe while the app runs)
  restore <file> [--force]    replace the database with a backup (stop the app first)`;

const kb = (n: number) => `${Math.max(1, Math.round(n / 1024))} KB`;
const when = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace("T", " ") + " UTC";

if (cmd === "users") {
  const { listUsers } = await import("./users.ts");
  for (const u of listUsers()) {
    const how = [u.password_hash && "password", u.google_sub && "google"].filter(Boolean).join(" + ");
    console.log(`${u.email}\t${u.name}\t${how}\t${new Date(u.created_at).toISOString().slice(0, 10)}`);
  }
} else if (cmd === "reset-password" && arg) {
  const { endAllSessions, hashPassword, setPassword, userByEmail } = await import("./users.ts");
  const user = userByEmail(arg);
  if (!user) {
    console.error(`No account for ${arg}`);
    process.exit(1);
  }
  const temp = randomBytes(6).toString("base64url");
  setPassword(user.id, await hashPassword(temp));
  endAllSessions(user.id);
  console.log(`Temporary password for ${user.email}: ${temp}\nThey can change it under Account after signing in.`);
} else if (cmd === "backups") {
  const { listBackups } = await import("./backup.ts");
  const { BACKUP_DIR, BACKUP_MIRROR_DIR } = await import("./paths.ts");
  for (const [label, dir] of [["Backups", BACKUP_DIR], ["Copies", BACKUP_MIRROR_DIR]] as const) {
    if (!dir) continue;
    const files = listBackups(dir);
    console.log(`${label} in ${dir}${files.length ? "" : ": none"}`);
    for (const b of files) console.log(`  ${b.name}\t${kb(b.bytes)}\t${when(b.modified)}`);
  }
  if (!BACKUP_MIRROR_DIR) console.log("No second copy is set up (BACKUP_MIRROR_DIR).");
  const res = await fetch(`http://localhost:${process.env.PORT ?? 3001}/api/health`).catch(() => null);
  if (!res) console.log("\nThe app isn't running here, so there's no health report.");
  else {
    const h = (await res.json()) as { ok: boolean; problems: string[] };
    console.log(h.ok ? "\nHealthy." : `\nProblems:\n${h.problems.map((p) => `  - ${p}`).join("\n")}`);
  }
} else if (cmd === "backup") {
  const { db } = await import("./db.ts");
  const { takeBackup, backupHealth } = await import("./backup.ts");
  const b = await takeBackup(db);
  console.log(`Saved ${b.path} (${kb(b.bytes)})`);
  for (const p of backupHealth().problems) console.log(`Warning: ${p}`);
} else if (cmd === "restore" && arg) {
  const { findBackup, restoreBackup, serverLooksRunning } = await import("./backup.ts");
  const path = findBackup(arg);
  if (!path) {
    console.error(`No backup called ${arg}. See: node server/cli.ts backups`);
    process.exit(1);
  }
  if (serverLooksRunning() && flag !== "--force") {
    console.error(
      "The app looks like it's still running. Stop it first:\n" +
        "  docker compose stop\n" +
        `  docker compose run --rm grocery-run node server/cli.ts restore ${arg}\n` +
        "  docker compose start\n" +
        "(If it really is stopped and stopped less than 90 seconds ago, wait a moment or add --force.)",
    );
    process.exit(1);
  }
  const { savedAs } = await restoreBackup(path).catch((e: Error) => {
    console.error(e.message);
    process.exit(1);
  });
  console.log(`Restored ${path}.`);
  if (savedAs) console.log(`The database it replaced is saved as ${savedAs}, so this can be undone the same way.`);
  console.log(
    "Start the app again (docker compose start). Phones reload the restored lists when they reconnect;\n" +
      "anything changed on a phone while it was offline is sent again on top. Accounts and sign-ins made\n" +
      "after the backup are gone, so those people sign in or sign up again.",
  );
} else {
  console.log(usage);
  process.exit(cmd ? 1 : 0);
}
