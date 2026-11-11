// Prices & receipts on the phone: each list's product catalog (kept on the phone too, so the estimate
// works with no signal), the trip estimate, and reading receipts.
import { useEffect, useSyncExternalStore } from "react";
import type { Item, PricePoint, PriceUnit, Product, Receipt, ReceiptSummary } from "../../shared/types";
import { api, useStore } from "./store";
import { safeStorage, saveStorage } from "./utils";

/** "Fairlife 2% Chocolate Milk!" → "fairlife 2% chocolate milk" (same as the server's) */
export function keyOf(s: string) {
  return s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9%]+/g, " ").trim();
}

/** Whether this person has prices turned on (Account → Prices & receipts) */
export function usePricesOn() {
  return useStore().user?.prefs?.prices === true;
}

// ---------- catalogs ----------

const cacheKey = (listId: string) => `gr.products.${listId}`;
const catalogs = new Map<string, Product[]>();
const subs = new Set<() => void>();
const notify = () => subs.forEach((s) => s());

function catalogOf(listId: string): Product[] {
  if (!catalogs.has(listId)) catalogs.set(listId, safeStorage<Product[]>(cacheKey(listId), []));
  return catalogs.get(listId)!;
}

export async function refreshCatalog(listId: string) {
  try {
    const products = await api<Product[]>("GET", `/api/lists/${listId}/products`);
    catalogs.set(listId, products);
    saveStorage(cacheKey(listId), products);
    notify();
  } catch {
    // offline: keep what this phone has
  }
}

/** The list's products, most bought first; fetched when the list opens and after changes. */
export function useCatalog(listId: string, enabled: boolean): Product[] {
  useEffect(() => {
    if (!enabled) return;
    void refreshCatalog(listId);
    const onVisible = () => document.visibilityState === "visible" && void refreshCatalog(listId);
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [listId, enabled]);
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => (enabled ? catalogOf(listId) : EMPTY),
  );
}
const EMPTY: Product[] = [];

/** Which product an item on the list means, by its name or a name it's been called. */
export function productIndex(catalog: Product[]) {
  const byKey = new Map<string, Product>();
  for (const p of catalog) for (const k of p.keys) if (!byKey.has(k)) byKey.set(k, p);
  return (title: string) => byKey.get(keyOf(title));
}

// ---------- money ----------

export const money = (c: number) => `$${(c / 100).toFixed(2)}`;
export const unitLabel = (u: PriceUnit | null) => (!u || u === "each" ? "" : `/${u}`);
export const priceLabel = (p: Product) => (p.priceCents == null ? null : `${money(p.priceCents)}${unitLabel(p.priceUnit)}`);

const WEIGHT: Record<string, PriceUnit> = { lb: "lb", lbs: "lb", pound: "lb", pounds: "lb", kg: "kg", oz: "oz" };

/** A guess at what one item costs, from its product's price and the item's quantity. */
export function itemCost(item: Item, p: Product | undefined): number | null {
  if (!p || p.priceCents == null) return null;
  const m = item.quantity.trim().toLowerCase().match(/^(?:x\s*)?(\d+(?:\.\d+)?)\s*([a-z]*)/);
  const n = m ? Number(m[1]) : 1;
  const unit = m?.[2] ? WEIGHT[m[2]] : undefined;
  if (p.priceUnit && p.priceUnit !== "each") {
    // Sold by weight: use the weight if the item says one, else what it came to last time.
    if (unit === p.priceUnit) return Math.round(p.priceCents * n);
    return (p.paidCents ?? p.priceCents) * (unit ? 1 : m ? n : 1);
  }
  return Math.round(p.priceCents * (n > 0 && n < 100 ? n : 1));
}

/** The groceries-only estimate for what's still to get. */
export function estimate(items: Item[], find: (title: string) => Product | undefined) {
  let total = 0;
  let missing = 0;
  for (const i of items) {
    if (i.completed) continue;
    const c = itemCost(i, find(i.title));
    if (c == null) missing++;
    else total += c;
  }
  return { total, missing };
}

// ---------- prices ----------

export async function setItemPrice(listId: string, title: string, priceCents: number | null, unit: PriceUnit = "each") {
  await api("PUT", `/api/lists/${listId}/prices`, { title, priceCents, unit });
  await refreshCatalog(listId);
}

export const priceHistory = (listId: string, title: string) =>
  api<{ history: PricePoint[] }>("GET", `/api/lists/${listId}/prices?title=${encodeURIComponent(title)}`).then((r) => r.history);

// ---------- receipts ----------

export const scanReceipt = (listId: string, images: { data: string }[]) =>
  api<Receipt>("POST", `/api/lists/${listId}/receipts`, { images, tzOffset: new Date().getTimezoneOffset() });

export const listReceipts = (listId: string) => api<ReceiptSummary[]>("GET", `/api/lists/${listId}/receipts`);
export const getReceipt = (id: string) => api<Receipt>("GET", `/api/receipts/${id}`);
export const receiptPhotoUrl = (id: string, n: number) => `/api/receipts/${id}/photos/${n}`;

export async function confirmReceipt(r: Receipt, lines: { i: number; name: string; skip: boolean }[], store: string) {
  const out = await api<{ saved: number }>("POST", `/api/receipts/${r.id}/confirm`, { lines, store });
  await refreshCatalog(r.listId);
  return out.saved;
}

export async function deleteReceipt(r: { id: string }, listId: string) {
  await api("DELETE", `/api/receipts/${r.id}`);
  await refreshCatalog(listId);
}
