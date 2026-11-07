import { useEffect, useState, type ReactNode } from "react";
import { Flag, Trash2 } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { Input, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { deleteItem, getState, sortedLists, updateItem, useStore } from "@/lib/store";
import { SECTIONS } from "@/lib/sections";
import { Toggle } from "./ListEditor";
import { Provenance } from "./Provenance";

export function ItemDetail({ itemId, onClose, color }: { itemId: string | null; onClose: () => void; color: string }) {
  const state = useStore();
  const item = itemId ? state.items[itemId] : undefined;
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [quantity, setQuantity] = useState("");
  const [section, setSection] = useState("Other");
  const [flagged, setFlagged] = useState(false);
  const [listId, setListId] = useState("");

  useEffect(() => {
    if (!itemId) return;
    const it = getState().items[itemId];
    if (!it) return;
    setTitle(it.title);
    setNotes(it.notes);
    setQuantity(it.quantity);
    setSection(it.section);
    setFlagged(it.flagged);
    setListId(it.listId);
  }, [itemId]);

  // Someone else deleted it while the sheet was open
  useEffect(() => {
    if (itemId && !item) onClose();
  }, [itemId, item, onClose]);

  const save = () => {
    if (!item) return onClose();
    const patch = { title: title.trim(), notes: notes.trim(), quantity: quantity.trim(), section, flagged, listId };
    const changed = (Object.keys(patch) as (keyof typeof patch)[]).some((k) => patch[k] !== item[k]);
    if (patch.title && changed) updateItem(item.id, patch);
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
              <select value={section} onChange={(e) => setSection(e.target.value)} className="bg-transparent text-right text-muted-foreground outline-none">
                {SECTIONS.map((s) => <option key={s}>{s}</option>)}
              </select>
            </Row>
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
