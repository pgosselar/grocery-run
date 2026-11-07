import { useSyncExternalStore } from "react";
import type { GroceryList, HistoryEntry, Item, ListColor, Op, ServerMessage, Snapshot } from "../../shared/types";
import { categorize, parseQuantity } from "./sections";
import { safeStorage, saveStorage, uid } from "./utils";

/*
 * Local-first store:
 *  - every mutation is applied locally right away and appended to a persisted outbox
 *  - the outbox is flushed to POST /api/ops whenever we're online
 *  - a websocket pushes other family members' changes in real time
 *  - conflicts resolve last-write-wins on updatedAt (server enforces the same rule)
 */

export interface State {
  lists: Record<string, GroceryList>;
  items: Record<string, Item>;
  loaded: boolean;
  online: boolean;
  pending: number;
  authError: boolean;
}

const CACHE_KEY = "gr.cache.v1";
const OUTBOX_KEY = "gr.outbox.v1";
const CLIENT_KEY = "gr.client";

const clientId: string = (() => {
  const existing = safeStorage<string | null>(CLIENT_KEY, null);
  if (existing) return existing;
  const id = uid();
  saveStorage(CLIENT_KEY, id);
  return id;
})();

let userName = "";
export function setUserName(name: string) {
  userName = name;
}

const cached = safeStorage<{ lists: GroceryList[]; items: Item[]; version: number } | null>(CACHE_KEY, null);
let outbox: Op[] = safeStorage<Op[]>(OUTBOX_KEY, []);
let serverVersion = cached?.version ?? -1;

let state: State = {
  lists: Object.fromEntries((cached?.lists ?? []).map((l) => [l.id, l])),
  items: Object.fromEntries((cached?.items ?? []).map((i) => [i.id, i])),
  loaded: !!cached,
  online: false,
  pending: outbox.length,
  authError: false,
};

const listeners = new Set<() => void>();
let persistTimer: ReturnType<typeof setTimeout> | undefined;

function setState(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
  clearTimeout(persistTimer);
  persistTimer = setTimeout(persist, 300);
}

function persist() {
  saveStorage(CACHE_KEY, {
    lists: Object.values(state.lists),
    items: Object.values(state.items),
    version: serverVersion,
  });
}

export function useStore(): State {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
}

export function getState() {
  return state;
}

// ---------- applying ops ----------

function applyOpsLocal(ops: Op[]) {
  let lists = state.lists;
  let items = state.items;
  for (const op of ops) {
    switch (op.type) {
      case "list.put": {
        const cur = lists[op.list.id];
        if (cur && cur.updatedAt > op.list.updatedAt) break;
        lists = { ...lists, [op.list.id]: op.list };
        break;
      }
      case "list.delete": {
        if (!lists[op.id]) break;
        const { [op.id]: _, ...rest } = lists;
        lists = rest;
        items = Object.fromEntries(Object.entries(items).filter(([, i]) => i.listId !== op.id));
        break;
      }
      case "item.put": {
        const cur = items[op.item.id];
        if (cur && cur.updatedAt > op.item.updatedAt) break;
        items = { ...items, [op.item.id]: op.item };
        break;
      }
      case "item.delete": {
        if (!items[op.id]) break;
        const { [op.id]: _, ...rest } = items;
        items = rest;
        break;
      }
    }
  }
  setState({ lists, items });
}

function commit(ops: Op[]) {
  if (!ops.length) return;
  applyOpsLocal(ops);
  outbox = [...outbox, ...ops];
  saveStorage(OUTBOX_KEY, outbox);
  setState({ pending: outbox.length });
  scheduleFlush(0);
}

// ---------- network ----------

let flushing = false;
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let retryDelay = 1000;

function scheduleFlush(ms: number) {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, ms);
}

async function flush(): Promise<boolean> {
  if (flushing) return false;
  if (!outbox.length) return true;
  flushing = true;
  const batch = outbox.slice(0, 200);
  try {
    const res = await fetch("/api/ops", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ops: batch, clientId }),
    });
    if (res.status === 401) {
      setState({ authError: true });
      return false;
    }
    if (!res.ok) throw new Error(`ops ${res.status}`);
    const { version } = (await res.json()) as { version: number };
    serverVersion = version;
    outbox = outbox.slice(batch.length);
    saveStorage(OUTBOX_KEY, outbox);
    setState({ pending: outbox.length });
    retryDelay = 1000;
    if (outbox.length) scheduleFlush(0);
    return true;
  } catch {
    retryDelay = Math.min(retryDelay * 2, 30_000);
    scheduleFlush(retryDelay);
    return false;
  } finally {
    flushing = false;
  }
}

async function refresh() {
  await flush();
  try {
    const res = await fetch("/api/state");
    if (res.status === 401) return setState({ authError: true });
    if (!res.ok) return;
    const snap = (await res.json()) as Snapshot;
    serverVersion = snap.version;
    // Server snapshot is the base; re-apply anything still queued locally on top.
    state = {
      ...state,
      lists: Object.fromEntries(snap.lists.map((l) => [l.id, l])),
      items: Object.fromEntries(snap.items.map((i) => [i.id, i])),
    };
    applyOpsLocal(outbox);
    setState({ loaded: true });
  } catch {
    /* offline — keep cached data */
  }
}

let ws: WebSocket | null = null;
let wsDelay = 1000;
let wsTimer: ReturnType<typeof setTimeout> | undefined;

function connect() {
  clearTimeout(wsTimer);
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const sock = new WebSocket(`${proto}://${location.host}/ws`);
  ws = sock;
  sock.onmessage = (ev) => {
    const msg = JSON.parse(ev.data as string) as ServerMessage;
    if (msg.type === "hello") {
      wsDelay = 1000;
      setState({ online: true });
      if (msg.version !== serverVersion || outbox.length) void refresh();
      else setState({ loaded: true });
    } else if (msg.type === "ops") {
      serverVersion = msg.version;
      if (msg.origin !== clientId) applyOpsLocal(msg.ops);
    }
  };
  sock.onclose = () => {
    if (ws === sock) ws = null;
    setState({ online: false });
    wsDelay = Math.min(wsDelay * 2, 30_000);
    wsTimer = setTimeout(connect, wsDelay);
  };
  sock.onerror = () => sock.close();
}

export function startSync() {
  setState({ authError: false });
  connect();
  void refresh();
}

if (typeof window !== "undefined") {
  // iOS suspends PWAs in the background and silently kills sockets.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      wsDelay = 1000;
      connect();
      void refresh();
    }
  });
  window.addEventListener("online", () => {
    wsDelay = 1000;
    connect();
    scheduleFlush(0);
  });
}

// ---------- selectors ----------

export function listItems(s: State, listId: string): Item[] {
  return Object.values(s.items)
    .filter((i) => i.listId === listId)
    .sort((a, b) => a.position - b.position || a.createdAt - b.createdAt);
}

export function sortedLists(s: State): GroceryList[] {
  return Object.values(s.lists).sort((a, b) => a.position - b.position || a.createdAt - b.createdAt);
}

/** Distinct past item titles, most-used first — powers add-item suggestions. */
export function itemHistory(s: State): string[] {
  const counts = new Map<string, { title: string; n: number; last: number }>();
  for (const i of Object.values(s.items)) {
    const key = i.title.trim().toLowerCase();
    if (!key) continue;
    const c = counts.get(key);
    if (c) {
      c.n++;
      c.last = Math.max(c.last, i.updatedAt);
    } else counts.set(key, { title: i.title.trim(), n: 1, last: i.updatedAt });
  }
  return [...counts.values()].sort((a, b) => b.n - a.n || b.last - a.last).map((c) => c.title);
}

// ---------- actions ----------

const now = () => Date.now();

export function createList(input: { name: string; color: ListColor; icon: string; grouped: boolean }): string {
  const lists = Object.values(state.lists);
  const t = now();
  const list: GroceryList = {
    id: uid(),
    ...input,
    position: lists.length ? Math.max(...lists.map((l) => l.position)) + 1 : 0,
    createdAt: t,
    updatedAt: t,
  };
  commit([{ type: "list.put", list }]);
  return list.id;
}

export function updateList(id: string, patch: Partial<Omit<GroceryList, "id">>) {
  const cur = state.lists[id];
  if (!cur) return;
  commit([{ type: "list.put", list: { ...cur, ...patch, updatedAt: now() } }]);
}

export function deleteList(id: string) {
  commit([{ type: "list.delete", id, at: now() }]);
}

export function reorderLists(ids: string[]) {
  const t = now();
  const ops: Op[] = [];
  ids.forEach((id, position) => {
    const l = state.lists[id];
    if (l && l.position !== position) ops.push({ type: "list.put", list: { ...l, position, updatedAt: t } });
  });
  commit(ops);
}

export function addItem(
  listId: string,
  rawTitle: string,
  exact?: { quantity?: string; section?: string },
): string | null {
  // Re-adding from history keeps the title/quantity/section exactly as they were.
  const parsed = exact ? { title: rawTitle.trim(), quantity: exact.quantity ?? "" } : parseQuantity(rawTitle);
  const { title, quantity } = parsed;
  if (!title) return null;
  const siblings = listItems(state, listId);
  const t = now();
  const position = siblings.length ? siblings[siblings.length - 1].position + 1 : 0;
  const item: Item = {
    id: uid(),
    listId,
    title,
    notes: "",
    quantity,
    section: exact?.section || categorize(title),
    flagged: false,
    completed: false,
    completedAt: null,
    position,
    addedBy: userName,
    createdAt: t,
    updatedAt: t,
  };
  commit([{ type: "item.put", item }]);
  return item.id;
}

export function updateItem(id: string, patch: Partial<Omit<Item, "id">>) {
  const cur = state.items[id];
  if (!cur) return;
  const next = { ...cur, ...patch, updatedAt: now() };
  // Re-categorize on rename unless the section was set by hand in this same patch.
  if (patch.title !== undefined && patch.section === undefined && cur.section === categorize(cur.title)) {
    next.section = categorize(next.title);
  }
  commit([{ type: "item.put", item: next }]);
}

export function toggleItem(id: string) {
  const cur = state.items[id];
  if (!cur) return;
  updateItem(
    id,
    cur.completed
      ? { completed: false, completedAt: null, completedBy: "" }
      : { completed: true, completedAt: now(), completedBy: userName },
  );
}

export function deleteItem(id: string) {
  commit([{ type: "item.delete", id, at: now() }]);
}

export function clearCompleted(listId: string) {
  const t = now();
  commit(listItems(state, listId).filter((i) => i.completed).map((i) => ({ type: "item.delete", id: i.id, at: t })));
}

export function reorderItems(ids: string[]) {
  const t = now();
  const ops: Op[] = [];
  ids.forEach((id, position) => {
    const it = state.items[id];
    if (it && it.position !== position) ops.push({ type: "item.put", item: { ...it, position, updatedAt: t } });
  });
  commit(ops);
}

// ---------- history ----------

export async function fetchHistory(
  listId: string,
  section: string | null,
  limit = 10,
): Promise<{ entries: HistoryEntry[]; sections: string[] }> {
  const qs = new URLSearchParams({ listId, limit: String(limit) });
  if (section) qs.set("section", section);
  const res = await fetch(`/api/history?${qs}`);
  if (!res.ok) throw new Error(`history ${res.status}`);
  return res.json();
}

/** Offline fallback: check-offs still in the local cache (cleared items aren't included). */
export function localHistory(listId: string, section: string | null, limit = 10): HistoryEntry[] {
  return listItems(state, listId)
    .filter((i) => i.completed && (section === null || i.section === section))
    .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
    .slice(0, limit)
    .map((i) => ({
      itemId: i.id, listId: i.listId, title: i.title, quantity: i.quantity, section: i.section,
      addedBy: i.addedBy, createdAt: i.createdAt, completedBy: i.completedBy ?? "",
      completedAt: i.completedAt ?? i.updatedAt,
    }));
}

// ---------- auth ----------

export async function fetchMe(): Promise<{ authEnabled: boolean; session: { name: string } | null }> {
  const res = await fetch("/api/me");
  return res.json();
}

export async function login(name: string, passcode: string): Promise<string | null> {
  const res = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, passcode }),
  });
  if (res.ok) return null;
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error ?? "Couldn't sign in";
}
