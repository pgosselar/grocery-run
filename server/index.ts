import express from "express";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import { applyOps, history, snapshot, version } from "./db.ts";
import { login, me, requireAuth, sessionFrom } from "./auth.ts";
import type { Op, ServerMessage } from "../shared/types.ts";

const PORT = Number(process.env.PORT ?? 3001);
const app = express();
app.set("trust proxy", true);
app.use(express.json({ limit: "1mb" }));

app.get("/api/me", me);
app.post("/api/login", login);
app.get("/api/state", requireAuth, (_req, res) => res.json(snapshot()));

app.get("/api/history", requireAuth, (req, res) => {
  const listId = String(req.query.listId ?? "");
  const section = typeof req.query.section === "string" && req.query.section ? req.query.section : null;
  const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 100);
  if (!listId) return res.status(400).json({ error: "listId required" });
  res.json(history(listId, section, limit));
});

const OP_TYPES = new Set(["list.put", "list.delete", "item.put", "item.delete"]);

app.post("/api/ops", requireAuth, (req, res) => {
  const { ops, clientId } = req.body as { ops: Op[]; clientId: string };
  if (!Array.isArray(ops) || !ops.every((o) => o && OP_TYPES.has(o.type))) {
    return res.status(400).json({ error: "bad ops" });
  }
  const result = applyOps(ops);
  if (result.applied.length) {
    broadcast({ type: "ops", ops: result.applied, version: result.version, origin: String(clientId ?? "") });
  }
  res.json({ version: result.version, applied: result.applied.length });
});

const dist = join(import.meta.dirname, "..", "dist");
if (existsSync(dist)) {
  app.use(express.static(dist, { index: false }));
  app.get(/^(?!\/api|\/ws).*/, (_req, res) => res.sendFile(join(dist, "index.html")));
}

const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  if (!req.url?.startsWith("/ws") || !sessionFrom(req)) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    send(ws, { type: "hello", version: version() });
  });
});

function send(ws: WebSocket, msg: ServerMessage) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}
function broadcast(msg: ServerMessage) {
  const data = JSON.stringify(msg);
  for (const ws of wss.clients) if (ws.readyState === WebSocket.OPEN) ws.send(data);
}

// Keep connections alive through proxies / mobile networks
setInterval(() => {
  for (const ws of wss.clients) ws.ping();
}, 25_000).unref();

server.listen(PORT, () => console.log(`grocery-run server on http://localhost:${PORT}`));
