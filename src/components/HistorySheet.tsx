import { useEffect, useState } from "react";
import { CloudOff, History, Plus, Check } from "lucide-react";
import type { HistoryEntry } from "../../shared/types";
import { Sheet } from "@/components/ui/sheet";
import { addItem, fetchHistory, listItems, localHistory, useStore } from "@/lib/store";
import { sectionRank } from "@/lib/sections";
import { cn } from "@/lib/utils";
import { Provenance } from "./Provenance";

const LIMIT = 10;

/** Last ten check-offs for a list, optionally narrowed to one store section. */
export function HistorySheet({
  listId,
  section,
  onClose,
  color,
}: {
  listId: string;
  /** undefined = closed, null = whole list, string = one section */
  section: string | null | undefined;
  onClose: () => void;
  color: string;
}) {
  const open = section !== undefined;
  const state = useStore();
  const [filter, setFilter] = useState<string | null>(null);
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [sections, setSections] = useState<string[]>([]);
  const [offline, setOffline] = useState(false);
  const [readded, setReadded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (open) {
      setFilter(section ?? null);
      setReadded(new Set());
    }
  }, [open, section]);

  // Skeleton only when switching what we're looking at, not on live refreshes.
  useEffect(() => {
    setEntries(null);
  }, [open, listId, filter]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetchHistory(listId, filter, LIMIT)
      .then((r) => {
        if (cancelled) return;
        setEntries(r.entries);
        setSections(r.sections.sort((a, b) => sectionRank(a) - sectionRank(b)));
        setOffline(false);
      })
      .catch(() => {
        if (cancelled) return;
        setEntries(localHistory(listId, filter, LIMIT));
        setOffline(true);
      });
    return () => {
      cancelled = true;
    };
    // Refetch when items change so a check-off elsewhere shows up live.
  }, [open, listId, filter, state.items]);

  const openTitles = new Set(
    listItems(state, listId).filter((i) => !i.completed).map((i) => i.title.toLowerCase()),
  );

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={filter ? `${filter} History` : "Recently Completed"}
      hideCancel
    >
      <div className="space-y-3 pb-4">
        {sections.length > 1 && (
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
            {[null, ...sections].map((s) => (
              <button
                key={s ?? "all"}
                onClick={() => setFilter(s)}
                className={cn(
                  "shrink-0 rounded-full border px-3.5 py-1.5 text-sm transition-colors",
                  filter === s ? "border-transparent text-white" : "bg-card",
                )}
                style={filter === s ? { backgroundColor: color } : undefined}
              >
                {s ?? "All"}
              </button>
            ))}
          </div>
        )}

        {offline && (
          <p className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
            <CloudOff className="size-4 shrink-0" /> Offline: showing only items still on this phone.
          </p>
        )}

        {entries === null ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-24 animate-pulse rounded-xl bg-card" />
            ))}
          </div>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-center text-muted-foreground">
            <History className="mb-3 size-10 opacity-40" />
            <p>Nothing checked off{filter ? ` in ${filter}` : ""} yet.</p>
          </div>
        ) : (
          <ul className="divide-y overflow-hidden rounded-xl bg-card shadow-sm">
            {entries.map((e) => {
              const key = `${e.itemId}:${e.completedAt}`;
              const onList = openTitles.has(e.title.toLowerCase()) || readded.has(key);
              return (
                <li key={key} className="flex gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex items-baseline gap-2">
                      <span className="truncate text-[17px] font-medium">{e.title}</span>
                      {e.quantity && <span className="text-sm text-muted-foreground">Qty {e.quantity}</span>}
                      {!filter && <span className="ml-auto shrink-0 text-xs text-muted-foreground">{e.section}</span>}
                    </div>
                    <Provenance
                      addedBy={e.addedBy}
                      createdAt={e.createdAt}
                      completedBy={e.completedBy}
                      completedAt={e.completedAt}
                      color={color}
                      compact
                    />
                  </div>
                  <button
                    aria-label={onList ? `${e.title} is on the list` : `Add ${e.title} again`}
                    disabled={onList}
                    onClick={() => {
                      addItem(listId, e.title, { quantity: e.quantity, section: e.section });
                      setReadded((s) => new Set(s).add(key));
                    }}
                    className="flex size-8 shrink-0 items-center justify-center self-center rounded-full border-2 transition-colors disabled:opacity-60"
                    style={{ borderColor: color, color: onList ? "white" : color, backgroundColor: onList ? color : undefined }}
                  >
                    {onList ? <Check className="size-4" strokeWidth={3} /> : <Plus className="size-4" strokeWidth={3} />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Sheet>
  );
}
