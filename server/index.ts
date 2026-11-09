import express from "express";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import { applyOps, db, history, memberIds, removeMember, roleOf, snapshot, version } from "./db.ts";
import { backupHealth, startBackups } from "./backup.ts";
import {
  currentUser, forgotPassword, resetPassword, googleCallback, googleStart, login, logout, me, requireAuth, signup, updateAccount, userFrom,
} from "./auth.ts";
import { acceptInvite, inviteFor, onJoin, previewInvite } from "./users.ts";
import { importPhoto, importRecipe } from "./recipe/index.ts";
import {
  createRecipe, deleteDishPhoto, deleteRecipe, editRecipe, getDishPhoto, getRecipe, listRecipes, putDishPhoto, recipeShopping,
  tagRecipe, untagRecipe,
} from "./recipes.ts";
import type { Op, ServerMessage } from "../shared/types.ts";

const PORT = Number(process.env.PORT ?? 3001);
const app = express();
app.set("trust proxy", true);
// Recipe photos are the only big uploads (already shrunk on the phone); everything else stays small.
app.use("/api/recipe/photo", express.json({ limit: "16mb" }));
app.use("/api/recipes/:id/photo", express.json({ limit: "8mb" }));
app.use(express.json({ limit: "1mb" }));

// ---------- accounts ----------

// For Docker's health check: fails when backups have stopped working, so the container shows as unhealthy.
app.get("/api/health", (_req, res) => {
  const health = backupHealth();
  res.status(health.ok ? 200 : 503).json(health);
});
app.get("/api/me", me);
app.post("/api/auth/signup", signup);
app.post("/api/auth/login", login);
app.post("/api/auth/logout", logout);
app.post("/api/auth/forgot", forgotPassword);
app.post("/api/auth/reset", resetPassword);
app.get("/api/auth/google", googleStart);
app.get("/api/auth/google/callback", googleCallback);
app.patch("/api/account", requireAuth, updateAccount);

// ---------- data ----------

app.get("/api/state", requireAuth, (_req, res) => res.json(snapshot(currentUser(res).id)));

app.get("/api/history", requireAuth, (req, res) => {
  const listId = String(req.query.listId ?? "");
  const section = typeof req.query.section === "string" && req.query.section ? req.query.section : null;
  const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 100);
  if (!roleOf(listId, currentUser(res).id)) return res.status(404).json({ error: "No such list" });
  res.json(history(listId, section, limit));
});

app.post("/api/recipe", requireAuth, importRecipe);
app.post("/api/recipe/photo", requireAuth, importPhoto);

// ---------- recipe box ----------

app.get("/api/recipes", requireAuth, listRecipes);
app.post("/api/recipes", requireAuth, createRecipe);
app.get("/api/recipes/:id", requireAuth, getRecipe);
app.patch("/api/recipes/:id", requireAuth, editRecipe);
app.delete("/api/recipes/:id", requireAuth, deleteRecipe);
app.post("/api/recipes/:id/lists", requireAuth, tagRecipe);
app.delete("/api/recipes/:id/lists/:listId", requireAuth, untagRecipe);
app.post("/api/recipes/:id/shopping", requireAuth, recipeShopping);
app.get("/api/recipes/:id/photo", requireAuth, getDishPhoto);
app.put("/api/recipes/:id/photo", requireAuth, putDishPhoto);
app.delete("/api/recipes/:id/photo", requireAuth, deleteDishPhoto);

app.post("/api/ops", requireAuth, (req, res) => {
  const { ops, clientId } = (req.body ?? {}) as { ops: Op[]; clientId: string };
  if (!Array.isArray(ops) || ops.length > 500 || !ops.every((o) => o && typeof o.type === "string")) {
    return res.status(400).json({ error: "bad ops" });
  }
  const user = currentUser(res);
  const result = applyOps(user, ops);
  const origin = String(clientId ?? "");
  // Group deliveries per recipient so each person gets one message with only their lists' changes.
  const perUser = new Map<string, Op[]>();
  const refresh = new Set<string>();
  for (const d of result.deliveries) {
    for (const u of d.userIds) perUser.set(u, [...(perUser.get(u) ?? []), d.op]);
    d.refresh?.forEach((u) => refresh.add(u));
  }
  for (const [u, uops] of perUser) sendTo([u], { type: "ops", ops: uops, version: result.version, origin });
  if (refresh.size) sendTo([...refresh], { type: "refresh" });
  res.json({ version: result.version, applied: result.deliveries.length, rejected: result.rejected });
});

// ---------- sharing ----------

const inviteUrl = (req: express.Request, token: string) =>
  `${(process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "")}/#/invite/${token}`;

app.get("/api/lists/:id/invite", requireAuth, (req, res) => {
  const id = String(req.params.id);
  if (!roleOf(id, currentUser(res).id)) return res.status(404).json({ error: "No such list" });
  const inv = inviteFor(id, currentUser(res).id);
  res.json({ url: inviteUrl(req, inv.token), expiresAt: inv.expiresAt });
});

app.post("/api/lists/:id/invite/reset", requireAuth, (req, res) => {
  const id = String(req.params.id);
  if (roleOf(id, currentUser(res).id) !== "owner") return res.status(403).json({ error: "Only the list owner can do that" });
  const inv = inviteFor(id, currentUser(res).id, true);
  res.json({ url: inviteUrl(req, inv.token), expiresAt: inv.expiresAt });
});

/** Remove someone (owner), or leave the list yourself. */
app.delete("/api/lists/:id/members/:userId", requireAuth, (req, res) => {
  const id = String(req.params.id);
  const target = String(req.params.userId);
  const me = currentUser(res).id;
  const myRole = roleOf(id, me);
  const theirRole = roleOf(id, target);
  if (!myRole || !theirRole) return res.status(404).json({ error: "Not a member" });
  if (target === me && myRole === "owner") return res.status(400).json({ error: "The owner can't leave. Delete the list instead." });
  if (target !== me && myRole !== "owner") return res.status(403).json({ error: "Only the list owner can remove people" });
  const before = memberIds(id);
  removeMember(id, target);
  sendTo(before, { type: "refresh" });
  res.json({ ok: true });
});

app.get("/api/invites/:token", (req, res) => {
  const preview = previewInvite(String(req.params.token));
  if (!preview) return res.status(404).json({ error: "This invite link has expired or been reset. Ask for a new one." });
  res.json(preview);
});

app.post("/api/invites/:token/accept", requireAuth, (req, res) => {
  const user = currentUser(res);
  const listId = acceptInvite(String(req.params.token), user.id);
  if (!listId) return res.status(404).json({ error: "This invite link has expired or been reset. Ask for a new one." });
  res.json({ listId });
});

app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

// ---------- app ----------

const dist = join(import.meta.dirname, "..", "dist");
if (existsSync(dist)) {
  app.use(express.static(dist, { index: false }));
  app.get(/^(?!\/api|\/ws).*/, (_req, res) => res.sendFile(join(dist, "index.html")));
}

const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });
const sockets = new Map<WebSocket, string>();

server.on("upgrade", (req, socket, head) => {
  const user = req.url?.startsWith("/ws") ? userFrom(req) : null;
  // Refuse cross-site pages opening a socket with our cookie.
  let originHost: string | undefined = req.headers.host;
  try {
    if (req.headers.origin) originHost = new URL(req.headers.origin).host;
  } catch {
    originHost = undefined;
  }
  if (!user || originHost !== req.headers.host) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    sockets.set(ws, user.id);
    ws.on("close", () => sockets.delete(ws));
    send(ws, { type: "hello", version: version() });
  });
});

function send(ws: WebSocket, msg: ServerMessage) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}
function sendTo(userIds: string[], msg: ServerMessage) {
  const ids = new Set(userIds);
  const data = JSON.stringify(msg);
  for (const [ws, uid] of sockets) if (ids.has(uid) && ws.readyState === WebSocket.OPEN) ws.send(data);
}

// Someone joined a list (invite link, during sign-up or after): everyone on it refetches to see them.
onJoin((listId) => sendTo(memberIds(listId), { type: "refresh" }));

// Keep connections alive through proxies / mobile networks
setInterval(() => {
  for (const ws of wss.clients) ws.ping();
}, 25_000).unref();

server.listen(PORT, () => console.log(`grocery-run server on http://localhost:${PORT}`));
startBackups(db);
