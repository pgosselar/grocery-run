import { useSyncExternalStore } from "react";
import type {
  AuthInfo, GroceryList, HistoryEntry, InvitePreview, Item, ListColor, ListSection, Member, Op, RecipeImport,
  ServerMessage, Snapshot, User, UserPrefs,
} from "../../shared/types";
import {
  OTHER, categorize, defaultSections, learnSection, parseQuantity, resolveSection, sectionName, sectionWithWord, unlearnSection,
} from "./sections";
import { showToast } from "./toast";
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
  members: Record<string, Member[]>;
  user: User | null;
  loaded: boolean;
  online: boolean;
  pending: number;
}

const CACHE_KEY = "gr.cache.v2";
const OUTBOX_KEY = "gr.outbox.v2";
const USER_KEY = "gr.user";
const CLIENT_KEY = "gr.client";

const clientId: string = (() => {
  const existing = safeStorage<string | null>(CLIENT_KEY, null);
  if (existing) return existing;
  const id = uid();
  saveStorage(CLIENT_KEY, id);
  return id;
})();

interface Cache {
  userId: string;
  lists: GroceryList[];
  items: Item[];
  members: Record<string, Member[]>;
  version: number;
}

const cached = safeStorage<Cache | null>(CACHE_KEY, null);
let outbox: Op[] = safeStorage<Op[]>(OUTBOX_KEY, []);
let serverVersion = cached?.version ?? -1;

let state: State = {
  lists: Object.fromEntries((cached?.lists ?? []).map((l) => [l.id, l])),
  items: Object.fromEntries((cached?.items ?? []).map((i) => [i.id, i])),
  members: cached?.members ?? {},
  user: safeStorage<User | null>(USER_KEY, null),
  loaded: !!cached,
  online: false,
  pending: outbox.length,
};

const userName = () => state.user?.name ?? "";

const listeners = new Set<() => void>();
let persistTimer: ReturnType<typeof setTimeout> | undefined;

function setState(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
  clearTimeout(persistTimer);
  persistTimer = setTimeout(persist, 300);
}

function persist() {
  if (!state.user) return;
  saveStorage(CACHE_KEY, {
    userId: state.user.id,
    lists: Object.values(state.lists),
    items: Object.values(state.items),
    members: state.members,
    version: serverVersion,
  } satisfies Cache);
}

/** Forget everything on this phone (signing out, or a different person signing in). */
function resetLocal() {
  outbox = [];
  serverVersion = -1;
  saveStorage(OUTBOX_KEY, []);
  saveStorage(CACHE_KEY, null);
  saveStorage(RECIPE_CACHE_KEY, null);
  state = { ...state, lists: {}, items: {}, members: {}, loaded: false, pending: 0 };
}

/** Recipes this phone has opened, for cooking offline. Cleared whenever someone else signs in here. */
export const RECIPE_CACHE_KEY = "gr.recipes.v1";

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
        // Position is per person: keep ours when someone else edits a shared list.
        lists = { ...lists, [op.list.id]: { ...op.list, position: cur?.position ?? op.list.position } };
        break;
      }
      case "list.order": {
        lists = { ...lists };
        op.ids.forEach((id, position) => {
          if (lists[id]) lists[id] = { ...lists[id], position };
        });
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
      markSignedOut();
      return false;
    }
    if (!res.ok) throw new Error(`ops ${res.status}`);
    const { version, rejected } = (await res.json()) as { version: number; rejected: number };
    serverVersion = version;
    // Something we did locally wasn't allowed (e.g. we were removed from that list): resync.
    if (rejected) setTimeout(() => void refresh(), 0);
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
    if (res.status === 401) return markSignedOut();
    if (!res.ok) return;
    const snap = (await res.json()) as Snapshot;
    serverVersion = snap.version;
    // Server snapshot is the base; re-apply anything still queued locally on top.
    state = {
      ...state,
      lists: Object.fromEntries(snap.lists.map((l) => [l.id, l])),
      items: Object.fromEntries(snap.items.map((i) => [i.id, i])),
      members: snap.members,
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
      if (msg.origin !== clientId) {
        // A list we haven't seen (made on another of our devices): fetch it with its members.
        const fresh = msg.ops.some((o) => o.type === "list.put" && !state.lists[o.list.id]);
        applyOpsLocal(msg.ops);
        if (fresh) void refresh();
      }
    } else if (msg.type === "refresh") {
      void refresh();
    }
  };
  sock.onclose = () => {
    if (ws === sock) ws = null;
    setState({ online: false });
    if (!syncing) return;
    wsDelay = Math.min(wsDelay * 2, 30_000);
    wsTimer = setTimeout(connect, wsDelay);
  };
  sock.onerror = () => sock.close();
}

let syncing = false;
let lastUserId = cached?.userId ?? state.user?.id ?? null;

export function startSync(user: User) {
  // A different person signing in on this phone mustn't see (or send) the last person's data.
  if (lastUserId && lastUserId !== user.id) resetLocal();
  lastUserId = user.id;
  saveStorage(USER_KEY, user);
  setState({ user });
  syncing = true;
  connect();
  void refresh();
}

/** Session expired or was revoked: show sign-in, but keep queued changes in case the same person signs back in. */
export function markSignedOut() {
  stopSync();
  setState({ user: null });
}

function stopSync() {
  syncing = false;
  const sock = ws;
  ws = null;
  clearTimeout(wsTimer);
  if (sock) {
    sock.onclose = null;
    sock.close();
  }
}

if (typeof window !== "undefined") {
  // iOS suspends PWAs in the background and silently kills sockets.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && syncing) {
      wsDelay = 1000;
      connect();
      void refresh();
    }
  });
  window.addEventListener("online", () => {
    if (!syncing) return;
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

export function createList(input: {
  name: string;
  color: ListColor;
  icon: string;
  grouped: boolean;
  /** Copy store sections from this list; standard sections if not given */
  sectionsFrom?: string;
}): string {
  const lists = Object.values(state.lists);
  const t = now();
  const { sectionsFrom, ...rest } = input;
  const source = sectionsFrom ? state.lists[sectionsFrom]?.sections : undefined;
  const list: GroceryList = {
    id: uid(),
    ...rest,
    sections: source ? structuredClone(source) : defaultSections(),
    position: lists.length ? Math.max(...lists.map((l) => l.position)) + 1 : 0,
    createdAt: t,
    updatedAt: t,
  };
  if (state.user) {
    setState({ members: { ...state.members, [list.id]: [{ userId: state.user.id, name: state.user.name, role: "owner" }] } });
  }
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
  commit([{ type: "list.order", ids }]);
}

export function sectionsOf(listId: string): ListSection[] {
  return state.lists[listId]?.sections ?? defaultSections();
}

/** Save edited sections. Items in a section that was deleted move to the catch-all section. */
export function saveSections(listId: string, sections: ListSection[]) {
  const list = state.lists[listId];
  if (!list) return;
  const t = now();
  const keep = new Set(sections.map((s) => s.id));
  const ops: Op[] = [{ type: "list.put", list: { ...list, sections, updatedAt: t } }];
  for (const it of listItems(state, listId)) {
    if (!keep.has(it.section)) ops.push({ type: "item.put", item: { ...it, section: resolveSection(sections, OTHER), updatedAt: t } });
  }
  commit(ops);
}

export function addItem(
  listId: string,
  rawTitle: string,
  exact?: { quantity?: string; section?: string; notes?: string },
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
    notes: exact?.notes ?? "",
    quantity,
    section: exact?.section ? resolveSection(sectionsOf(listId), exact.section) : categorize(title, sectionsOf(listId)),
    flagged: false,
    completed: false,
    completedAt: null,
    position,
    addedBy: userName(),
    addedById: state.user?.id,
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
  const ops: Op[] = [];
  const sections = sectionsOf(next.listId);
  const list = state.lists[next.listId];
  let moved: { learned: boolean; previousOwner: string | null } | null = null;
  if (next.listId !== cur.listId) {
    // Moved to another store's list: sort it the way that list sorts things.
    next.section = categorize(next.title, sections);
  } else if (patch.section !== undefined && resolveSection(sections, patch.section) !== resolveSection(sections, cur.section)) {
    // Moved by hand: this list remembers, so next time it goes straight there.
    const previousOwner = sectionWithWord(sections, next.title);
    const learned = learnSection(sections, next.title, patch.section);
    if (learned !== sections && list) ops.push({ type: "list.put", list: { ...list, sections: learned, updatedAt: now() } });
    moved = { learned: learned !== sections, previousOwner };
  } else if (patch.title !== undefined && cur.section === categorize(cur.title, sections)) {
    // Renamed and its section was the automatic one: re-sort.
    next.section = categorize(next.title, sections);
  }
  ops.push({ type: "item.put", item: next });
  commit(ops);

  if (moved && list) {
    const to = sectionName(sections, next.section);
    showToast(
      moved.learned ? `“${next.title}” will always go to ${to} on ${list.name}.` : `Moved “${next.title}” to ${to}.`,
      () => undoMove(id, cur.section, next.section, moved.learned ? moved.previousOwner : undefined),
    );
  }
}

/** Put an item back where it was and, if the move taught the list a word, forget it again. */
function undoMove(id: string, from: string, to: string, previousOwner: string | null | undefined) {
  const item = state.items[id];
  if (!item || item.section !== to) return; // someone has moved it since
  const ops: Op[] = [];
  const list = state.lists[item.listId];
  if (list && previousOwner !== undefined) {
    ops.push({ type: "list.put", list: { ...list, sections: unlearnSection(list.sections, item.title, to, previousOwner), updatedAt: now() } });
  }
  ops.push({ type: "item.put", item: { ...item, section: from, updatedAt: now() } });
  commit(ops);
}

export function toggleItem(id: string) {
  const cur = state.items[id];
  if (!cur) return;
  updateItem(
    id,
    cur.completed
      ? { completed: false, completedAt: null, completedBy: "" }
      : { completed: true, completedAt: now(), completedBy: userName(), completedById: state.user?.id },
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

// ---------- recipe import ----------

export async function requestRecipeImport(
  input: { listId: string } & ({ url: string } | { text: string } | { images: { data: string; mediaType: string }[] }),
): Promise<RecipeImport> {
  let res: Response;
  try {
    res = await fetch("images" in input ? "/api/recipe/photo" : "/api/recipe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch {
    throw new Error("You're offline. Recipe import needs a connection.");
  }
  const body = (await res.json().catch(() => ({}))) as RecipeImport & { error?: string };
  if (!res.ok) throw new Error(body.error ?? "Couldn't import that recipe.");
  return body;
}

// ---------- auth ----------

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("Can't reach the server. Check your connection.");
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Something went wrong (${res.status})`);
  return data;
}

let photosEnabled = false;
/** Whether the server can read recipes from photos (it needs Claude). Known after the first fetchMe. */
export const canReadPhotos = () => photosEnabled;

export const fetchMe = (invite?: string | null) =>
  api<AuthInfo>("GET", `/api/me${invite ? `?invite=${encodeURIComponent(invite)}` : ""}`).then((i) => {
    photosEnabled = !!i.recipePhotos;
    return i;
  });

/** The person who used this phone last, for starting up offline. */
export const cachedUser = () => safeStorage<User | null>(USER_KEY, null);

export function signIn(mode: "login" | "signup", body: { email: string; password: string; name?: string; invite?: string | null }) {
  return api<{ user: User; listId: string | null }>("POST", `/api/auth/${mode}`, body);
}

export const requestPasswordReset = (email: string) => api("POST", "/api/auth/forgot", { email });

export const resetPassword = (token: string, password: string) =>
  api<{ user: User; listId: null }>("POST", "/api/auth/reset", { token, password });

export async function signOut() {
  await api("POST", "/api/auth/logout").catch(() => {});
  stopSync();
  resetLocal();
  saveStorage(USER_KEY, null);
  setState({ user: null });
}

export async function updateAccount(patch: { name?: string; currentPassword?: string; newPassword?: string; prefs?: UserPrefs }) {
  const { user } = await api<{ user: User }>("PATCH", "/api/account", patch);
  saveStorage(USER_KEY, user);
  setState({ user });
  if (patch.name) void refresh(); // member names on shared lists
  return user;
}

// ---------- sharing ----------

export const getInviteLink = (listId: string, reset = false) =>
  api<{ url: string; expiresAt: number }>(reset ? "POST" : "GET", `/api/lists/${listId}/invite${reset ? "/reset" : ""}`);

export const previewInvite = (token: string) => api<InvitePreview>("GET", `/api/invites/${encodeURIComponent(token)}`);

export async function acceptInvite(token: string): Promise<string> {
  const { listId } = await api<{ listId: string }>("POST", `/api/invites/${encodeURIComponent(token)}/accept`);
  await refresh();
  return listId;
}

export async function removeMember(listId: string, userId: string) {
  await api("DELETE", `/api/lists/${listId}/members/${userId}`);
  await refresh();
}
