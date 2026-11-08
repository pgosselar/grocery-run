import { Check } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { updateItem, useStore } from "@/lib/store";
import { resolveSection } from "@/lib/sections";

/** Pick a section for one item. The list remembers the choice for next time. */
export function MoveSheet({ itemId, onClose, color }: { itemId: string | null; onClose: () => void; color: string }) {
  const state = useStore();
  const item = itemId ? state.items[itemId] : undefined;
  const list = item ? state.lists[item.listId] : undefined;
  const sections = list?.sections ?? [];
  const current = item ? resolveSection(sections, item.section) : "";

  return (
    <Sheet open={!!item} onOpenChange={(o) => !o && onClose()} title="Move to Section" hideCancel>
      {item && list && (
        <div className="space-y-3 pb-4">
          <p className="px-1 text-sm text-muted-foreground">
            Where does <b className="font-medium text-foreground">{item.title}</b> go at {list.name}? This list will remember
            for next time.
          </p>
          <ul className="divide-y overflow-hidden rounded-xl bg-card shadow-sm">
            {sections.map((s) => (
              <li key={s.id}>
                <button
                  className="flex w-full items-center justify-between px-4 py-3 text-left text-[17px] active:bg-accent"
                  onClick={() => {
                    if (s.id !== current) updateItem(item.id, { section: s.id });
                    onClose();
                  }}
                >
                  {s.name}
                  {s.id === current && <Check className="size-5" style={{ color }} />}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Sheet>
  );
}
