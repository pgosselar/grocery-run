import { useEffect, useState } from "react";
import { Check, ChevronDown, ChevronRight, CircleAlert, Loader2, Receipt as ReceiptIcon, Sparkles, Trash2, X } from "lucide-react";
import type { Receipt, ReceiptLine, ReceiptSummary } from "../../shared/types";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { prepareReceiptPhoto, type PreparedImage } from "@/lib/images";
import { confirmReceipt, deleteReceipt, getReceipt, listReceipts, money, receiptPhotoUrl, scanReceipt, unitLabel } from "@/lib/products";
import { showToast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { PhotoButtons } from "./RecipeImportSheet";

const MAX_PHOTOS = 4;
const when = (ms: number | null) =>
  ms ? new Date(ms).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "No date";

type Edit = { name: string; skip: boolean };

/** Photograph a receipt, check what was read, and save its prices to this list's store. */
export function ReceiptSheet({ listId, open, onClose, color }: { listId: string; open: boolean; onClose: () => void; color: string }) {
  const [photos, setPhotos] = useState<PreparedImage[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [reading, setReading] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [recent, setRecent] = useState<ReceiptSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPhotos([]);
    setReceipt(null);
    setError(null);
    setRecent(null);
    listReceipts(listId).then(setRecent).catch(() => setRecent([]));
  }, [open, listId]);

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setPreparing(true);
    setError(null);
    try {
      const room = MAX_PHOTOS - photos.length;
      const ready = await Promise.all([...files].slice(0, room).map(prepareReceiptPhoto));
      setPhotos((p) => [...p, ...ready]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't use that photo");
    } finally {
      setPreparing(false);
    }
  };

  const read = async () => {
    setReading(true);
    setError(null);
    try {
      setReceipt(await scanReceipt(listId, photos.map((p) => ({ data: p.data }))));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read that receipt");
    } finally {
      setReading(false);
    }
  };

  const openSaved = async (id: string) => {
    setError(null);
    try {
      setReceipt(await getReceipt(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't open that receipt");
    }
  };

  if (receipt) {
    return (
      <ReceiptReview
        receipt={receipt}
        open={open}
        color={color}
        onBack={() => { setReceipt(null); setPhotos([]); listReceipts(listId).then(setRecent).catch(() => {}); }}
        onClose={onClose}
      />
    );
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()} title="Scan Receipt" hideCancel doneLabel="Close" onDone={onClose}>
      <div className="space-y-5 pb-6">
        <p className="px-1 text-sm text-muted-foreground">
          Take a photo of the receipt after you shop. Its prices go into this list's estimate, and the names on it are
          remembered for next time. A long receipt can take up to {MAX_PHOTOS} photos, top to bottom.
        </p>

        {reading ? (
          <div className="flex flex-col items-center gap-3 rounded-xl bg-card px-4 py-10 text-center shadow-sm">
            <Loader2 className="size-8 animate-spin" style={{ color }} />
            <p className="font-medium">Reading the receipt…</p>
            <p className="text-sm text-muted-foreground">This takes 20 seconds or so.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              {photos.map((p, n) => (
                <div key={p.preview} className="relative aspect-[3/4] overflow-hidden rounded-xl bg-muted">
                  <img src={p.preview} alt={`Photo ${n + 1}`} className="size-full object-cover" />
                  <button
                    aria-label={`Remove photo ${n + 1}`}
                    className="absolute top-1 right-1 rounded-full bg-black/60 p-1 text-white"
                    onClick={() => setPhotos((ps) => ps.filter((x) => x !== p))}
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              ))}
              {photos.length < MAX_PHOTOS && (
                <PhotoButtons first={!photos.length} busy={false} preparing={preparing} color={color} onFiles={addFiles} nextLabel="Next part" />
              )}
            </div>
            {photos.length > 0 && (
              <Button size="lg" className="w-full" style={{ backgroundColor: color }} onClick={read}>
                <Sparkles /> Read Receipt
              </Button>
            )}
          </>
        )}

        {error && <p className="px-1 text-sm text-destructive">{error}</p>}

        {!reading && recent && recent.length > 0 && (
          <section>
            <h3 className="mb-1.5 px-1 text-sm font-medium text-muted-foreground">Recent receipts</h3>
            <ul className="divide-y overflow-hidden rounded-xl bg-card shadow-sm">
              {recent.map((r) => (
                <li key={r.id}>
                  <button className="flex w-full items-center gap-3 px-4 py-2.5 text-left active:bg-accent" onClick={() => openSaved(r.id)}>
                    <ReceiptIcon className="size-5 shrink-0" style={{ color }} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{r.store} · {when(r.purchasedAt ?? r.createdAt)}</span>
                      <span className="block text-xs text-muted-foreground">
                        {r.items} items{r.totalCents != null ? ` · ${money(r.totalCents)}` : ""}
                        {r.status === "review" ? " · not saved yet" : ""}
                      </span>
                    </span>
                    {r.status === "review" && <CircleAlert className="size-4.5 text-amber-500" />}
                    <ChevronRight className="size-5 text-muted-foreground/60" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </Sheet>
  );
}

const ORDER: Record<ReceiptLine["status"], number> = { low: 0, new: 1, high: 2, known: 3 };

function ReceiptReview({
  receipt, open, color, onBack, onClose,
}: { receipt: Receipt; open: boolean; color: string; onBack: () => void; onClose: () => void }) {
  const [edits, setEdits] = useState<Record<number, Edit>>(() =>
    Object.fromEntries(receipt.lines.map((l) => [l.i, { name: l.name, skip: !!l.skip }])),
  );
  const [store, setStore] = useState(receipt.store);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showKnown, setShowKnown] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const lines = [...receipt.lines].sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.i - b.i);
  const known = lines.filter((l) => l.status === "known");
  const rest = lines.filter((l) => l.status !== "known");
  const kept = receipt.lines.filter((l) => !edits[l.i]?.skip);
  const itemsTotal = kept.reduce((s, l) => s + l.totalCents, 0);
  const set = (i: number, patch: Partial<Edit>) => setEdits((e) => ({ ...e, [i]: { ...e[i], ...patch } }));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const saved = await confirmReceipt(
        receipt,
        receipt.lines.map((l) => ({ i: l.i, name: edits[l.i].name, skip: edits[l.i].skip })),
        store,
      );
      showToast(`Saved ${saved} price${saved === 1 ? "" : "s"} from ${store}`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await deleteReceipt(receipt, receipt.listId);
      showToast("Receipt deleted");
      onBack();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete");
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()} title="Check Receipt" onDone={save} doneLabel={busy ? "…" : "Save"} doneDisabled={busy}>
      <div className="space-y-4 pb-6">
        <div className="space-y-2 rounded-xl bg-card p-4 shadow-sm">
          <input
            value={store}
            onChange={(e) => setStore(e.target.value)}
            aria-label="Store"
            className="w-full bg-transparent text-lg font-semibold outline-none"
          />
          <div className="text-sm text-muted-foreground">
            {when(receipt.purchasedAt ?? receipt.createdAt)} · {receipt.lines.length} items
            {receipt.totalCents != null && ` · total ${money(receipt.totalCents)}`}
          </div>
          {receipt.photos > 0 && (
            <div className="flex gap-2 pt-1">
              {Array.from({ length: receipt.photos }, (_, n) => (
                <a key={n} href={receiptPhotoUrl(receipt.id, n)} target="_blank" rel="noopener" className="block">
                  <img src={receiptPhotoUrl(receipt.id, n)} alt={`Receipt photo ${n + 1}`} className="h-16 w-12 rounded-md object-cover" />
                </a>
              ))}
            </div>
          )}
        </div>

        {receipt.duplicateOf && receipt.status === "review" && (
          <p className="flex gap-2 rounded-xl bg-amber-500/15 p-3 text-sm text-amber-800 dark:text-amber-200">
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
            This looks like a receipt that's already saved (same store, time and total). Saving it again would count those
            prices twice; delete this copy instead.
          </p>
        )}

        <p className="px-1 text-sm text-muted-foreground">
          Fix any names that are wrong, and tap <X className="inline size-3.5" /> on anything that shouldn't count. Names you save
          here are matched automatically next time.
        </p>

        {rest.length > 0 && (
          <ul className="divide-y overflow-hidden rounded-xl bg-card shadow-sm">
            {rest.map((l) => <LineRow key={l.i} line={l} edit={edits[l.i]} onChange={(p) => set(l.i, p)} color={color} />)}
          </ul>
        )}

        {known.length > 0 && (
          <section>
            <button className="mb-1.5 flex items-center gap-1 px-1 text-sm font-medium text-muted-foreground" onClick={() => setShowKnown(!showKnown)}>
              <ChevronDown className={cn("size-4 transition-transform", !showKnown && "-rotate-90")} />
              <Check className="size-4 text-green-600" /> {known.length} matched from earlier receipts
            </button>
            {showKnown && (
              <ul className="divide-y overflow-hidden rounded-xl bg-card shadow-sm">
                {known.map((l) => <LineRow key={l.i} line={l} edit={edits[l.i]} onChange={(p) => set(l.i, p)} color={color} />)}
              </ul>
            )}
          </section>
        )}

        <div className="space-y-1 rounded-xl bg-card px-4 py-3 text-sm shadow-sm">
          <div className="flex justify-between"><span>Groceries ({kept.length})</span><span className="tabular-nums">{money(itemsTotal)}</span></div>
          {receipt.other.map((o, n) => (
            <div key={n} className="flex justify-between text-muted-foreground"><span className="truncate pr-3">{o.text}</span><span className="tabular-nums">{money(o.totalCents)}</span></div>
          ))}
          {receipt.totalCents != null && (
            <div className="flex justify-between border-t pt-1 font-medium"><span>Receipt total (with tax)</span><span className="tabular-nums">{money(receipt.totalCents)}</span></div>
          )}
        </div>

        {error && <p className="px-1 text-sm text-destructive">{error}</p>}

        <div className="flex items-center justify-between px-1">
          <button className="text-sm" style={{ color }} onClick={onBack}>← All receipts</button>
          {confirmDelete ? (
            <span className="flex items-center gap-2">
              <Button size="sm" variant="secondary" onClick={() => setConfirmDelete(false)}>Keep</Button>
              <Button size="sm" variant="destructive" disabled={busy} onClick={remove}>Delete</Button>
            </span>
          ) : (
            <button className="flex items-center gap-1 text-sm text-destructive" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="size-4" /> Delete receipt
            </button>
          )}
        </div>
        {receipt.photos === 0 && (
          <p className="px-1 text-xs text-muted-foreground">The photos of this receipt have been deleted; they're only kept for a week.</p>
        )}
      </div>
    </Sheet>
  );
}

const BADGE: Record<ReceiptLine["status"], { label: string; className: string }> = {
  known: { label: "Matched before", className: "text-green-700 bg-green-500/10" },
  high: { label: "Matched", className: "text-green-700 bg-green-500/10" },
  low: { label: "Check this", className: "text-amber-700 bg-amber-500/15" },
  new: { label: "New", className: "text-sky-700 bg-sky-500/10" },
};

function LineRow({ line, edit, onChange, color }: { line: ReceiptLine; edit: Edit; onChange: (p: Partial<Edit>) => void; color: string }) {
  const b = BADGE[line.status];
  const detail = [
    line.weight && line.weightUnit ? `${line.weight} ${line.weightUnit} @ ${money(line.unitPriceCents)}${unitLabel(line.weightUnit)}` : null,
    !line.weight && line.quantity > 1 ? `${line.quantity} @ ${money(line.unitPriceCents)}` : null,
    line.discountCents ? `saved ${money(line.discountCents)}` : null,
    line.itemTitle ? `on the list as “${line.itemTitle}”` : null,
  ].filter(Boolean);
  return (
    <li className={cn("px-4 py-2.5", edit.skip && "opacity-45")}>
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">{line.code ? `${line.code} ` : ""}{line.text}</span>
        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium", b.className)}>{b.label}</span>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <input
          value={edit.name}
          disabled={edit.skip}
          onChange={(e) => onChange({ name: e.target.value })}
          aria-label={`Name for ${line.text}`}
          className="min-w-0 flex-1 rounded-md bg-muted px-2 py-1.5 text-[15px] outline-none disabled:line-through"
        />
        <span className="shrink-0 text-[15px] tabular-nums">{money(line.totalCents)}</span>
        <button
          aria-label={edit.skip ? `Count ${line.text}` : `Don't count ${line.text}`}
          onClick={() => onChange({ skip: !edit.skip })}
          className="shrink-0 rounded-full p-1 text-muted-foreground active:bg-accent"
          style={edit.skip ? { color } : undefined}
        >
          {edit.skip ? <Check className="size-4.5" /> : <X className="size-4.5" />}
        </button>
      </div>
      {detail.length > 0 && <div className="mt-1 text-xs text-muted-foreground">{detail.join(" · ")}</div>}
    </li>
  );
}
