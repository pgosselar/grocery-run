// Admin tasks on the server, since there's no email for password resets.
//   docker compose exec grocery-run node server/cli.ts users
//   docker compose exec grocery-run node server/cli.ts reset-password someone@example.com
import { randomBytes } from "node:crypto";
import { endAllSessions, hashPassword, listUsers, setPassword, userByEmail } from "./users.ts";

const [cmd, arg] = process.argv.slice(2);

if (cmd === "users") {
  for (const u of listUsers()) {
    const how = [u.password_hash && "password", u.google_sub && "google"].filter(Boolean).join(" + ");
    console.log(`${u.email}\t${u.name}\t${how}\t${new Date(u.created_at).toISOString().slice(0, 10)}`);
  }
} else if (cmd === "reset-password" && arg) {
  const user = userByEmail(arg);
  if (!user) {
    console.error(`No account for ${arg}`);
    process.exit(1);
  }
  const temp = randomBytes(6).toString("base64url");
  setPassword(user.id, await hashPassword(temp));
  endAllSessions(user.id);
  console.log(`Temporary password for ${user.email}: ${temp}\nThey can change it under Account after signing in.`);
} else {
  console.log("Usage: node server/cli.ts users | reset-password <email>");
  process.exit(cmd ? 1 : 0);
}
