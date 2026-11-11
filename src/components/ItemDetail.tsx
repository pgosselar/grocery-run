import { useEffect, useState, type ReactNode } from "react";
import { Flag, Trash2 } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { Input, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { deleteItem, getState, sortedLists, updateItem, useStore } from "@/lib/store";
import { categorize, resolveSection } from "@/lib/sections";
import { Toggle } from "./ListEditor";
import { Provenance } from "./Provenance";
import type { PricePoint, PriceUnit } from "../../shared/types";
import { money, priceHistory, productIndex, setItemPrice, unitLabel, useCatalog, usePricesOn } from "@/lib/products";
import { showToast } from "@/lib/toast";

export function ItemDetail({ itemId, onClose, color }: { itemId: string | null; onClose: () => void; color: string }) {
  const state = useStore();
  const item = itemId ? state.items[itemId] : undefined;
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [quantity, setQuantity] = useState("");
  const [section, setSection] = useState("Other");
  const [flagged, setFlagged] = useState(false);
  const [listId, setListId] = useState("");
  const [price, setPrice] = useState("");
  const [unit, setUnit] = useState<PriceUnit>("each");
  const [history, setHistory] = useState<PricePoint[]>([]);
  const pricesOn = usePricesOn();
  const catalog = useCatalog(item?.listId ?? "", pricesOn && !!item);
  const product = item && pricesOn ? productIndex(catalog)(item.title) : undefined;

  useEffect(() => {
    if (!itemId) return;
    const it = getState().items[itemId];
    if (!it) return;
    setTitle(it.title);
    setNotes(it.notes);
    setQuantity(it.quantity);
    setSection(resolveSection(getState().lists[it.listId]?.sections ?? [], it.section));
    setFlagged(it.flagged);
    setListId(it.listId);
    setHistory([]);
  }, [itemId]);

  // The price fields follow the product's price, and its history loads alongside.
  useEffect(() => {
    if (!itemId || !pricesOn) return;
    const it = getState().items[itemId];
    if (!it) return;
    setPrice(product?.priceCents != null ? (product.priceCents / 100).toFixed(2) : "");
    setUnit(product?.priceUnit ?? "each");
    priceHistory(it.listId, it.title).then(setHistory).catch(() => setHistory([]));
  }, [itemId, pricesOn, product?.id, product?.priceCents]);

  // Someone else deleted it while the sheet was open
  useEffect(() => {
    if (itemId && !item) onClose();
  }, [itemId, item, onClose]);

  const list = state.lists[listId] ?? (item ? state.lists[item.listId] : undefined);
  const sections = list?.sections ?? [];
  const movedList = !!item && listId !== item.listId;
  const willLearn = !!item && !movedList && section !== resolveSection(sections, item.section) && categorize(title, sections) !== section;

  const save = () => {
    if (!item) return onClose();
    const patch = { title: title.trim(), notes: notes.trim(), quantity: quantity.trim(), section, flagged, listId };
    const changed = (Object.keys(patch) as (keyof typeof patch)[]).some((k) => patch[k] !== item[k]);
    if (patch.title && changed) updateItem(item.id, patch);
    if (pricesOn && !movedList) {
      const typed = price.trim() ? Math.round(Number(price.replace(/[$,\s]/g, "")) * 100) : null;
      const was = product?.priceCents ?? null;
      if (typed !== null && Number.isFinite(typed) && typed >= 0 && (typed !== was || unit !== (product?.priceUnit ?? "each"))) {
        setItemPrice(item.listId, patch.title || item.title, typed, unit).catch(() => showToast("Couldn't save the price"));
      } else if (typed === null && was !== null && product?.priceSource === "manual") {
        setItemPrice(item.listId, item.title, null).catch(() => showToast("Couldn't clear the price"));
      }
    }
    onClose();
  };

  return (
    <Sheet open={!!item} onOpenChange={(o) => !o && onClose()} title="Details" onDone={save} doneDisabled={!title.trim()}>
      {item && (
        <div className="space-y-4 pb-4">
          <div className="space-y-2 rounded-xl bg-card p-3">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className="border-0 bg-muted" />
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (brand, size, aisle…)" className="border-0 bg-muted" />
          </div>

          <div className="divide-y rounded-xl bg-card">
            <Row label="Quantity">
              <input
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="—"
                className="w-28 bg-transparent text-right text-muted-foreground outline-none"
              />
            </Row>
            <Row label="Section">
              <select
                value={section}
                disabled={movedList}
                onChange={(e) => setSection(e.target.value)}
                className="max-w-48 bg-transparent text-right text-muted-foreground outline-none disabled:opacity-50"
              >
                {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Row>
            {willLearn && (
              <p className="px-4 py-2 text-xs text-muted-foreground">
                “{title.trim()}” will always go to {sections.find((s) => s.id === section)?.name} on {list?.name}.
              </p>
            )}
            {movedList && (
              <p className="px-4 py-2 text-xs text-muted-foreground">It'll be sorted into {list?.name}'s own sections.</p>
            )}
            {pricesOn && (
              <Row label="Price">
                <span className="flex items-center gap-1 text-muted-foreground">
                  $
                  <input
                    value={price}
                    inputMode="decimal"
                    onChange={(e) => setPrice(e.target.value)}
                    placeholder="—"
                    aria-label="Price"
                    className="w-16 bg-transparent text-right outline-none"
                  />
                  <select value={unit} onChange={(e) => setUnit(e.target.value as PriceUnit)} aria-label="Price per" className="bg-transparent outline-none">
                    <option value="each">each</option>
                    <option value="lb">/lb</option>
                    <option value="kg">/kg</option>
                    <option value="oz">/oz</option>
                  </select>
                </span>
              </Row>
            )}
            {pricesOn && history.length > 0 && (
              <div className="space-y-0.5 px-4 py-2 text-xs text-muted-foreground">
                {history.slice(0, 4).map((h, n) => (
                  <div key={n} className="flex justify-between gap-3">
                    <span className="truncate">
                      {h.source === "receipt" ? `Paid at ${h.store ?? list?.name}` : "Typed in"} ·{" "}
                      {new Date(h.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    </span>
                    <span className="tabular-nums">{money(h.priceCents)}{unitLabel(h.unit)}</span>
                  </div>
                ))}
              </div>
            )}
            <Row label="List">
              <select value={listId} onChange={(e) => setListId(e.target.value)} className="max-w-48 bg-transparent text-right text-muted-foreground outline-none">
                {sortedLists(state).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </Row>
            <Row
              label={
                <span className="flex items-center gap-3">
                  <span className="flex size-7 items-center justify-center rounded-md bg-orange-500 text-white"><Flag className="size-4" /></span>
                  Flag
                </span>
              }
            >
              <Toggle checked={flagged} onChange={setFlagged} color={color} />
            </Row>
          </div>

          <div className="rounded-xl bg-card p-4">
            <Provenance
              addedBy={item.addedBy}
              createdAt={item.createdAt}
              completedBy={item.completedBy}
              completedAt={item.completed ? item.completedAt : null}
              color={color}
            />
          </div>

          <Button variant="ghost" className="w-full text-destructive" onClick={() => { deleteItem(item.id); onClose(); }}>
            <Trash2 /> Delete Item
          </Button>
        </div>
      )}
    </Sheet>
  );
}

function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-3 px-4 py-2 text-[17px]">
      <span>{label}</span>
      {children}
    </div>
  );
}
