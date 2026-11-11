// Prices & receipts. Each list (one store) learns the products bought there: from items checked off,
// from prices typed in, and from photos of receipts, which Claude reads and matches to the trip.
// Everything a person confirms is remembered, so a store's receipts need less checking each time.
import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { Item, PricePoint, PriceUnit, Product, Receipt, ReceiptLine, ReceiptSummary } from "../shared/types.ts";
import { db, listById, onCheckOff, roleOf, tx } from "./db.ts";
import { currentUser } from "./auth.ts";
import { MODEL, claudeEnabled, client } from "./recipe/claude.ts";

/** "Fairlife 2% Chocolate Milk!" → "fairlife 2% chocolate milk" */
export function keyOf(s: string) {
  return s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9%]+/g, " ").trim();
}

const PHOTO_DAYS = 7;
const MAX_PHOTOS = 4;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const UNITS = new Set<PriceUnit>(["each", "lb", "kg", "oz"]);

interface ProductRow {
  id: string;
  list_id: string;
  name: string;
  name_key: string;
  price_cents: number | null;
  price_unit: string | null;
  paid_cents: number | null;
  price_at: number | null;
  price_source: string | null;
  times_bought: number;
  last_bought_at: number | null;
}

// ---------- products ----------

const productById = db.prepare("SELECT * FROM products WHERE id = ? AND list_id = ?");
const productByKey = db.prepare("SELECT * FROM products WHERE list_id = ? AND name_key = ?");
const productByAlias = db.prepare(
  "SELECT p.* FROM product_aliases a JOIN products p ON p.id = a.product_id WHERE a.list_id = ? AND a.alias = ?",
);
const listProducts = db.prepare("SELECT * FROM products WHERE list_id = ? ORDER BY times_bought DESC, last_bought_at DESC");
const listNameAliases = db.prepare("SELECT alias, product_id FROM product_aliases WHERE list_id = ? AND alias LIKE 'name:%'");
const insertProduct = db.prepare(
  "INSERT INTO products(id, list_id, name, name_key, created_at) VALUES(?, ?, ?, ?, ?)",
);
const renameProduct = db.prepare("UPDATE products SET name = ?, name_key = ? WHERE id = ?");
const bought = db.prepare(
  "UPDATE products SET times_bought = times_bought + 1, last_bought_at = MAX(COALESCE(last_bought_at, 0), ?) WHERE id = ?",
);
const unbought = db.prepare("UPDATE products SET times_bought = MAX(times_bought - 1, 0) WHERE id = ?");
const boughtAtLeastOnce = db.prepare(
  "UPDATE products SET times_bought = MAX(times_bought, 1), last_bought_at = MAX(COALESCE(last_bought_at, 0), ?) WHERE id = ?",
);
const putAlias = db.prepare(
  "INSERT INTO product_aliases(list_id, alias, product_id) VALUES(?, ?, ?) ON CONFLICT(list_id, alias) DO UPDATE SET product_id = excluded.product_id",
);
const insertPrice = db.prepare(
  "INSERT INTO prices(product_id, price_cents, unit, paid_cents, observed_at, receipt_id, source, added_by) VALUES(?, ?, ?, ?, ?, ?, ?, ?)",
);
const latestPrice = db.prepare("SELECT * FROM prices WHERE product_id = ? ORDER BY observed_at DESC, rowid DESC LIMIT 1");
const setProductPrice = db.prepare(
  "UPDATE products SET price_cents = ?, price_unit = ?, paid_cents = ?, price_at = ?, price_source = ? WHERE id = ?",
);
const priceHistory = db.prepare(`
  SELECT p.price_cents, p.unit, p.paid_cents, p.observed_at, p.source, r.store
  FROM prices p LEFT JOIN receipts r ON r.id = p.receipt_id
  WHERE p.product_id = ? ORDER BY p.observed_at DESC LIMIT 20
`);
const deleteManualPrices = db.prepare("DELETE FROM prices WHERE product_id = ? AND source = 'manual'");

/** The product a name means on this list: its own name, or a name it's known by. */
function findByName(listId: string, name: string): ProductRow | undefined {
  const key = keyOf(name);
  if (!key) return undefined;
  return (productByKey.get(listId, key) ?? productByAlias.get(listId, `name:${key}`)) as ProductRow | undefined;
}

function findOrCreate(listId: string, name: string): ProductRow {
  const existing = findByName(listId, name);
  if (existing) return existing;
  const id = randomUUID();
  insertProduct.run(id, listId, name.trim().slice(0, 120), keyOf(name), Date.now());
  return productById.get(id, listId) as unknown as ProductRow;
}

/** Point the product's current price at its newest price on record. */
function refreshPrice(productId: string) {
  const p = latestPrice.get(productId) as
    | { price_cents: number; unit: string; paid_cents: number | null; observed_at: number; source: string }
    | undefined;
  setProductPrice.run(p?.price_cents ?? null, p?.unit ?? null, p?.paid_cents ?? null, p?.observed_at ?? null, p?.source ?? null, productId);
}

function toProduct(r: ProductRow, aliases: Map<string, string[]>): Product {
  return {
    id: r.id,
    name: r.name,
    keys: [r.name_key, ...(aliases.get(r.id) ?? [])],
    priceCents: r.price_cents,
    priceUnit: (r.price_unit as PriceUnit) ?? null,
    paidCents: r.paid_cents,
    priceAt: r.price_at,
    priceSource: (r.price_source as Product["priceSource"]) ?? null,
    timesBought: r.times_bought,
    lastBoughtAt: r.last_bought_at,
  };
}

// Every list learns what gets bought from it, whether or not anyone has prices turned on yet, so the
// suggestions already know the family's habits when someone does.
onCheckOff((item: Item, checked: boolean) => {
  if (!keyOf(item.title)) return;
  if (checked) {
    const p = findOrCreate(item.listId, item.title);
    bought.run(item.completedAt ?? Date.now(), p.id);
  } else {
    const p = findByName(item.listId, item.title);
    if (p) unbought.run(p.id);
  }
});

// ---------- handlers: catalog and prices ----------

function memberList(req: Request, res: Response, listId: string) {
  const list = roleOf(listId, currentUser(res).id) ? listById(listId) : null;
  if (!list) res.status(404).json({ error: "No such list" });
  return list;
}

export function getCatalog(req: Request, res: Response) {
  const listId = String(req.params.id);
  if (!memberList(req, res, listId)) return;
  const aliases = new Map<string, string[]>();
  for (const a of listNameAliases.all(listId) as { alias: string; product_id: string }[]) {
    aliases.set(a.product_id, [...(aliases.get(a.product_id) ?? []), a.alias.slice(5)]);
  }
  res.json((listProducts.all(listId) as unknown as ProductRow[]).map((r) => toProduct(r, aliases)));
}

/** Type a price for an item: { title, priceCents (null clears typed prices), unit } */
export function setPrice(req: Request, res: Response) {
  const listId = String(req.params.id);
  if (!memberList(req, res, listId)) return;
  const { title, priceCents, unit } = (req.body ?? {}) as { title?: unknown; priceCents?: unknown; unit?: unknown };
  if (typeof title !== "string" || !keyOf(title)) return res.status(400).json({ error: "Which item?" });
  const cents = priceCents === null ? null : Number(priceCents);
  if (cents !== null && !(Number.isInteger(cents) && cents >= 0 && cents < 1_000_000)) {
    return res.status(400).json({ error: "That price doesn't look right" });
  }
  const u = (UNITS.has(unit as PriceUnit) ? unit : "each") as PriceUnit;
  tx(() => {
    const p = findOrCreate(listId, title);
    if (cents === null) deleteManualPrices.run(p.id);
    else insertPrice.run(p.id, cents, u, null, Date.now(), null, "manual", currentUser(res).id);
    refreshPrice(p.id);
  });
  res.json({ ok: true });
}

export function getPriceHistory(req: Request, res: Response) {
  const listId = String(req.params.id);
  if (!memberList(req, res, listId)) return;
  const p = findByName(listId, String(req.query.title ?? ""));
  if (!p) return res.json({ history: [] });
  const history: PricePoint[] = (priceHistory.all(p.id) as Record<string, unknown>[]).map((r) => ({
    priceCents: Number(r.price_cents),
    unit: r.unit as PriceUnit,
    paidCents: (r.paid_cents as number | null) ?? null,
    at: Number(r.observed_at),
    source: r.source as PricePoint["source"],
    store: (r.store as string | null) ?? null,
  }));
  res.json({ history });
}

// ---------- receipts ----------

const insertReceipt = db.prepare(
  "INSERT INTO receipts(id, list_id, store, purchased_at, total_cents, status, data, uploaded_by, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)",
);
const receiptRow = db.prepare("SELECT * FROM receipts WHERE id = ?");
const updateReceipt = db.prepare("UPDATE receipts SET status = ?, data = ?, store = ?, purchased_at = ? WHERE id = ?");
const listReceiptRows = db.prepare(`
  SELECT r.*, (SELECT COUNT(*) FROM receipt_photos p WHERE p.receipt_id = r.id) AS photos
  FROM receipts r WHERE r.list_id = ? ORDER BY r.created_at DESC LIMIT 20
`);
const sameReceipt = db.prepare(
  "SELECT id FROM receipts WHERE list_id = ? AND status = 'saved' AND purchased_at = ? AND total_cents IS ? AND id != ? LIMIT 1",
);
const insertPhoto = db.prepare("INSERT INTO receipt_photos(receipt_id, n, jpeg, created_at) VALUES(?, ?, ?, ?)");
const photoCount = db.prepare("SELECT COUNT(*) AS n FROM receipt_photos WHERE receipt_id = ?");
const photoBytes = db.prepare("SELECT jpeg FROM receipt_photos WHERE receipt_id = ? AND n = ?");
const purgePhotos = db.prepare("DELETE FROM receipt_photos WHERE created_at < ?");
const receiptPrices = db.prepare("SELECT DISTINCT product_id FROM prices WHERE receipt_id = ?");
const deleteReceiptPrices = db.prepare("DELETE FROM prices WHERE receipt_id = ?");
const deleteReceiptRow = db.prepare("DELETE FROM receipts WHERE id = ?");
// What was on the list for this trip: things still to get, and things checked off in the last few days.
const tripItems = db.prepare(`
  SELECT DISTINCT json_extract(data, '$.title') AS title FROM items
  WHERE list_id = ? AND deleted = 0 AND (json_extract(data, '$.completed') = 0 OR json_extract(data, '$.completedAt') > ?)
`);
const recentlyChecked = db.prepare(
  "SELECT DISTINCT json_extract(data, '$.title') AS title FROM completions WHERE list_id = ? AND completed_at > ?",
);

setInterval(() => purgePhotos.run(Date.now() - PHOTO_DAYS * 864e5), 3_600_000).unref();

interface StoredReceipt {
  subtotalCents: number | null;
  lines: ReceiptLine[];
  other: { text: string; totalCents: number }[];
}

const cents = (dollars: number | null | undefined) => (dollars == null || !Number.isFinite(dollars) ? null : Math.round(dollars * 100));

const receiptSchema = z.object({
  isReceipt: z.boolean().describe("False if these photos aren't a store receipt"),
  store: z.string().describe("The store's name as a person would say it, e.g. 'Costco', 'Trader Joe's', 'Pete's Fresh Market'"),
  purchasedAt: z.string().describe("Date and time printed on the receipt as YYYY-MM-DDTHH:MM (24-hour), YYYY-MM-DD if there's no time, '' if neither"),
  subtotal: z.number().nullable(),
  tax: z.number().nullable(),
  total: z.number().nullable(),
  lines: z.array(
    z.object({
      text: z.string().describe("The item's description exactly as printed"),
      code: z.string().describe("The item number printed with it (Costco prints one before every item); '' if none"),
      kind: z.enum(["item", "deposit", "fee"]).describe("'deposit' for bottle/can deposits, 'fee' for bags and other charges; everything bought is 'item'"),
      quantity: z.number().describe("How many were bought: 1 unless the receipt shows more"),
      weight: z.number().nullable().describe("For things sold by weight: the weight; else null"),
      weightUnit: z.enum(["lb", "kg", "oz", ""]).describe("Unit of the weight, '' if not sold by weight"),
      unitPrice: z.number().nullable().describe("Price for one, or per weight unit for weighed items; null if not printed"),
      total: z.number().describe("What this line cost in dollars, after any discount folded into it"),
      discount: z.number().describe("Discounts and coupons folded into this line, as a positive number; 0 if none"),
      name: z.string().describe("A plain product name a person would recognize, with brand and size when you can tell"),
      match: z.number().int().describe("Number of the candidate this is the same product as, or 0 if none fits"),
      sure: z.boolean().describe("True if you're confident about both the name and the match"),
    }),
  ),
});

const RECEIPT_SYSTEM = `You read grocery receipts for a family's shopping list app.

Transcribe every purchased line. A long receipt may come in several photos, in order; don't repeat lines that overlap between photos.

- Fold discounts into the item they apply to: Costco prints instant savings as a separate line naming the item number (e.g. "/1234567 3.00-"); coupons and "you saved" lines usually sit right under their item. Report the line's total after the discount and the discount amount. Never output a discount as its own line.
- Weighed items: the weight and price per unit often print on the line above or below ("2.31 lb @ $0.59/lb"); combine them into the item's line.
- Quantities like "3 @ 1.99" mean quantity 3, unit price 1.99.
- Skip anything that isn't a purchase: subtotals, tax, totals, payment, change, card details, member numbers, savings summaries.
- name: expand the store's abbreviations into what a shopper would call the product, e.g. Costco's "KS ORG EGGS 24CT" is "Kirkland Signature Organic Eggs, 24 ct"; "FAIRLIFE 2% CHOC" is "Fairlife 2% Chocolate Milk". Keep the brand and size when printed or obvious. Don't invent details you can't tell; "Bananas" is fine.
- match: you're given candidates, things on this family's list for the trip and products they've bought at this store before. If the line is the same product as a candidate, give its number. A candidate typed casually ("chocolate milk") still matches a specific product ("Fairlife 2% Chocolate Milk"). Use 0 when nothing fits; don't force it.
- sure: false whenever the abbreviation is ambiguous or the match is a guess.`;

async function readReceipt(images: { data: string }[], candidates: string[], listName: string) {
  if (!client) throw new Error("Claude is not configured");
  const list = candidates.length ? candidates.map((c, i) => `${i + 1}. ${c}`).join("\n") : "(none yet)";
  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: "medium", format: betaZodOutputFormat(receiptSchema) },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: RECEIPT_SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          ...images.map((img) => ({ type: "image" as const, source: { type: "base64" as const, media_type: "image/jpeg" as const, data: img.data } })),
          {
            type: "text" as const,
            text: `This is a receipt from the store this list is for: ${listName}.\n${images.length > 1 ? `These ${images.length} photos are one receipt, top to bottom.\n` : ""}\nCandidates:\n${list}`,
          },
        ],
      },
    ],
  });
  if (response.stop_reason === "refusal") throw new Error("Claude declined to read this photo");
  if (response.stop_reason === "max_tokens") throw new Error("Claude's answer was cut off");
  if (!response.parsed_output) throw new Error("Claude returned nothing usable");
  return response.parsed_output;
}

/** "2026-11-11T17:31" in the phone's time zone (minutes from getTimezoneOffset) → ms */
function parseWhen(s: string, tzOffset: number): number | null {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  if (!m) return null;
  const utc = Date.UTC(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 12, m[5] ? +m[5] : 0) + tzOffset * 60_000;
  return Number.isFinite(utc) && utc < Date.now() + 864e5 ? utc : null;
}

function toReceipt(row: Record<string, unknown>, photos: number): Receipt {
  const data = JSON.parse(String(row.data)) as StoredReceipt;
  return {
    id: String(row.id),
    listId: String(row.list_id),
    store: String(row.store),
    purchasedAt: (row.purchased_at as number | null) ?? null,
    subtotalCents: data.subtotalCents,
    totalCents: (row.total_cents as number | null) ?? null,
    status: row.status as Receipt["status"],
    lines: data.lines,
    other: data.other,
    photos,
    uploadedBy: String(row.uploaded_by),
    createdAt: Number(row.created_at),
  };
}

function receiptFor(req: Request, res: Response) {
  const row = receiptRow.get(String(req.params.id)) as Record<string, unknown> | undefined;
  if (!row || !roleOf(String(row.list_id), currentUser(res).id)) {
    res.status(404).json({ error: "No such receipt" });
    return null;
  }
  return row;
}

/** Photos of a receipt → a reading to review: { images: [{data}], tzOffset } */
export async function scanReceipt(req: Request, res: Response) {
  const listId = String(req.params.id);
  const list = memberList(req, res, listId);
  if (!list) return;
  if (!claudeEnabled) return res.status(400).json({ error: "Reading receipts needs Claude, which isn't set up on this server." });
  const { images, tzOffset } = (req.body ?? {}) as { images?: unknown; tzOffset?: unknown };
  if (!Array.isArray(images) || !images.length || images.length > MAX_PHOTOS) {
    return res.status(400).json({ error: `Add between 1 and ${MAX_PHOTOS} photos.` });
  }
  const ok = images.every(
    (i) => !!i && typeof i.data === "string" && /^[A-Za-z0-9+/]+=*$/.test(i.data) && i.data.length * 0.75 <= MAX_PHOTO_BYTES,
  );
  if (!ok) return res.status(400).json({ error: "One of those photos couldn't be read. Try taking it again." });

  // Candidates: what was on the list for this trip, then what's been bought here before.
  const since = Date.now() - 3 * 864e5;
  const trip = [
    ...(tripItems.all(listId, since) as { title: string }[]).map((r) => r.title),
    ...(recentlyChecked.all(listId, since) as { title: string }[]).map((r) => r.title),
  ];
  const tripKeys = new Set<string>();
  const candidates: { label: string; productId: string | null; title: string | null }[] = [];
  for (const t of trip) {
    const k = keyOf(t ?? "");
    if (!k || tripKeys.has(k)) continue;
    tripKeys.add(k);
    const p = findByName(listId, t);
    candidates.push({ label: `${t} (on the list this trip${p && p.name_key !== k ? `; bought before as "${p.name}"` : ""})`, productId: p?.id ?? null, title: t });
  }
  for (const p of (listProducts.all(listId) as unknown as ProductRow[]).slice(0, 250)) {
    if (candidates.some((c) => c.productId === p.id)) continue;
    candidates.push({ label: `${p.name} (bought here before)`, productId: p.id, title: null });
  }

  let reading: z.infer<typeof receiptSchema>;
  try {
    reading = await readReceipt(images as { data: string }[], candidates.map((c) => c.label), list.name);
  } catch (err) {
    console.error("receipt reading failed:", err instanceof Error ? err.message : err);
    return res.status(502).json({ error: "Couldn't read that receipt just now. Try again in a moment." });
  }
  if (!reading.isReceipt || !reading.lines.length) {
    return res.status(422).json({ error: "Couldn't find a receipt in that photo. Try a flat, well-lit shot of the whole thing." });
  }

  const lines: ReceiptLine[] = [];
  const other: StoredReceipt["other"] = [];
  for (const l of reading.lines) {
    const total = cents(l.total) ?? 0;
    if (l.kind !== "item") {
      other.push({ text: l.text, totalCents: total });
      continue;
    }
    const qty = l.quantity > 0 ? l.quantity : 1;
    const weightUnit = l.weightUnit ? (l.weightUnit as PriceUnit) : null;
    const unitPriceCents = cents(l.unitPrice) ?? Math.round(total / (weightUnit && l.weight ? l.weight : qty));
    // Layer 1: a receipt line or item number someone already confirmed.
    const known = ((l.code && productByAlias.get(listId, `code:${keyOf(l.code)}`)) ||
      productByAlias.get(listId, `text:${keyOf(l.text)}`)) as ProductRow | undefined;
    const cand = l.match > 0 ? candidates[l.match - 1] : undefined;
    let productId: string | null = null;
    let name = l.name.trim() || l.text;
    let status: ReceiptLine["status"] = "new";
    if (known) {
      productId = known.id;
      name = known.name;
      status = "known";
    } else if (cand) {
      // Layers 2 and 3: Claude matched it to the trip or to something bought here before.
      productId = cand.productId;
      if (cand.productId && !cand.title) name = (productById.get(cand.productId, listId) as unknown as ProductRow).name;
      status = l.sure ? "high" : "low";
    } else if (!l.sure) status = "low";
    lines.push({
      i: lines.length,
      text: l.text,
      code: l.code,
      quantity: qty,
      weight: weightUnit ? l.weight : null,
      weightUnit,
      unitPriceCents,
      totalCents: total,
      discountCents: cents(l.discount) ?? 0,
      name,
      productId,
      itemTitle: cand?.title ?? null,
      status,
    });
  }

  const id = randomUUID();
  const now = Date.now();
  const data: StoredReceipt = { subtotalCents: cents(reading.subtotal), lines, other };
  tx(() => {
    insertReceipt.run(
      id, listId, reading.store.trim().slice(0, 80) || list.name, parseWhen(reading.purchasedAt, Number(tzOffset) || 0),
      cents(reading.total), "review", JSON.stringify(data), currentUser(res).id, now,
    );
    images.forEach((img: { data: string }, n: number) => insertPhoto.run(id, n, Buffer.from(img.data, "base64"), now));
  });
  const saved = toReceipt(receiptRow.get(id) as Record<string, unknown>, images.length);
  const dup = saved.purchasedAt ? (sameReceipt.get(listId, saved.purchasedAt, saved.totalCents, id) as { id: string } | undefined) : undefined;
  res.json({ ...saved, duplicateOf: dup?.id ?? null });
}

export function listReceipts(req: Request, res: Response) {
  const listId = String(req.params.id);
  if (!memberList(req, res, listId)) return;
  const out: ReceiptSummary[] = (listReceiptRows.all(listId) as Record<string, unknown>[]).map((r) => {
    const data = JSON.parse(String(r.data)) as StoredReceipt;
    return {
      id: String(r.id),
      store: String(r.store),
      purchasedAt: (r.purchased_at as number | null) ?? null,
      totalCents: (r.total_cents as number | null) ?? null,
      status: r.status as ReceiptSummary["status"],
      items: data.lines.length,
      photos: Number(r.photos),
      uploadedBy: String(r.uploaded_by),
      createdAt: Number(r.created_at),
    };
  });
  res.json(out);
}

export function getReceipt(req: Request, res: Response) {
  const row = receiptFor(req, res);
  if (!row) return;
  res.json(toReceipt(row, (photoCount.get(String(row.id)) as { n: number }).n));
}

export function getReceiptPhoto(req: Request, res: Response) {
  const row = receiptFor(req, res);
  if (!row) return;
  const photo = photoBytes.get(String(row.id), Number(req.params.n)) as { jpeg: Uint8Array } | undefined;
  if (!photo) return res.status(404).json({ error: "That photo has been deleted (they're kept a week)" });
  res.set("Cache-Control", "private, max-age=3600").type("image/jpeg").send(Buffer.from(photo.jpeg));
}

/**
 * Save a reviewed receipt: { lines: [{ i, name, skip }], store }. Every kept line becomes (or updates)
 * a product with its price, and its receipt text, item number and list name are remembered for next time.
 * Saving again (after a fix) replaces this receipt's earlier prices.
 */
export function confirmReceipt(req: Request, res: Response) {
  const row = receiptFor(req, res);
  if (!row) return;
  const listId = String(row.list_id);
  const receipt = toReceipt(row, 0);
  const { lines: edits, store } = (req.body ?? {}) as { lines?: unknown; store?: unknown };
  if (!Array.isArray(edits)) return res.status(400).json({ error: "Nothing to save" });
  const byIndex = new Map(edits.filter((e) => e && Number.isInteger(e.i)).map((e) => [e.i as number, e as { name?: unknown; skip?: unknown }]));
  const at = receipt.purchasedAt ?? receipt.createdAt;
  const user = currentUser(res).id;

  const saved = tx(() => {
    const touched = new Set((receiptPrices.all(receipt.id) as { product_id: string }[]).map((r) => r.product_id));
    deleteReceiptPrices.run(receipt.id);
    let count = 0;
    const lines = receipt.lines.map((line) => {
      const edit = byIndex.get(line.i);
      const name = typeof edit?.name === "string" && edit.name.trim() ? edit.name.trim().slice(0, 120) : line.name;
      const skip = edit?.skip === true;
      if (skip) return { ...line, name, skip: true };
      let p = line.productId ? (productById.get(line.productId, listId) as ProductRow | undefined) : undefined;
      if (p && keyOf(name) !== p.name_key) {
        // Renamed on review: the product takes the new name, unless that name is already another product.
        const other = findByName(listId, name);
        if (other && other.id !== p.id) p = other;
        else {
          putAlias.run(listId, `name:${p.name_key}`, p.id);
          renameProduct.run(name, keyOf(name), p.id);
          p = { ...p, name, name_key: keyOf(name) };
        }
      }
      p ??= findOrCreate(listId, name);
      // Remember how this store prints it, and what the family calls it.
      if (line.code) putAlias.run(listId, `code:${keyOf(line.code)}`, p.id);
      if (keyOf(line.text)) putAlias.run(listId, `text:${keyOf(line.text)}`, p.id);
      if (line.itemTitle && keyOf(line.itemTitle) !== p.name_key) putAlias.run(listId, `name:${keyOf(line.itemTitle)}`, p.id);
      insertPrice.run(p.id, line.unitPriceCents, line.weightUnit ?? "each", line.totalCents, at, receipt.id, "receipt", user);
      boughtAtLeastOnce.run(at, p.id);
      touched.add(p.id);
      count++;
      return { ...line, name, productId: p.id, skip: false };
    });
    for (const id of touched) refreshPrice(id);
    const data: StoredReceipt = { subtotalCents: receipt.subtotalCents, lines, other: receipt.other };
    const storeName = typeof store === "string" && store.trim() ? store.trim().slice(0, 80) : receipt.store;
    updateReceipt.run("saved", JSON.stringify(data), storeName, receipt.purchasedAt, receipt.id);
    return count;
  });
  res.json({ saved });
}

/** Delete a receipt and the prices it brought in (what was learned about names stays). */
export function deleteReceipt(req: Request, res: Response) {
  const row = receiptFor(req, res);
  if (!row) return;
  tx(() => {
    const touched = (receiptPrices.all(String(row.id)) as { product_id: string }[]).map((r) => r.product_id);
    deleteReceiptPrices.run(String(row.id));
    deleteReceiptRow.run(String(row.id));
    touched.forEach(refreshPrice);
  });
  res.json({ ok: true });
}
