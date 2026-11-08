import { useEffect, useState } from "react";
import { ChevronDown, GripVertical, Plus, Trash2, X } from "lucide-react";
import { DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { GroceryList, ListSection } from "../../shared/types";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { listItems, saveSections, useStore } from "@/lib/store";
import { OTHER, normalizeKeyword } from "@/lib/sections";
import { cn, uid } from "@/lib/utils";

/**
 * Edit one list's store sections: walking order, names, and the words that sort new items into each.
 * Changes apply to new items; what's already on the list stays put.
 */
export function SectionsSheet({ list, open, onClose, color }: { list: GroceryList; open: boolean; onClose: () => void; color: string }) {
  const state = useStore();
  const [draft, setDraft] = useState<ListSection[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(structuredClone(list.sections));
    setExpanded(null);
    setConfirmDelete(null);
  }, [open]);

  const counts: Record<string, number> = {};
  for (const i of listItems(state, list.id)) if (!i.completed) counts[i.section] = (counts[i.section] ?? 0) + 1;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 6 } }),
  );
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    setDraft((d) => {
      const ids = d.map((s) => s.id);
      return arrayMove(d, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
    });
  };

  const patch = (id: string, p: Partial<ListSection>) => setDraft((d) => d.map((s) => (s.id === id ? { ...s, ...p } : s)));

  const addSection = () => {
    const id = uid();
    // New sections go just above the catch-all.
    setDraft((d) => {
      const at = d.findIndex((s) => s.id === OTHER);
      const next = [...d];
      next.splice(at === -1 ? d.length : at, 0, { id, name: "", keywords: [] });
      return next;
    });
    setExpanded(id);
  };

  /** A word belongs to one section: adding it here takes it away from wherever it was. */
  const addKeyword = (id: string, raw: string) => {
    const words = raw.split(",").map(normalizeKeyword).filter(Boolean);
    if (!words.length) return;
    setDraft((d) =>
      d.map((s) => {
        const rest = s.keywords.filter((k) => !words.includes(k.trim()));
        return s.id === id ? { ...s, keywords: [...rest, ...words] } : { ...s, keywords: rest };
      }),
    );
  };

  const otherName = draft.find((s) => s.id === OTHER)?.name || "Other";
  const valid = draft.every((s) => s.name.trim());

  const save = () => {
    saveSections(list.id, draft.map((s) => ({ ...s, name: s.name.trim() })));
    onClose();
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()} title="Sections" onDone={save} doneDisabled={!valid}>
      <div className="space-y-3 pb-4">
        <p className="px-1 text-sm text-muted-foreground">
          Drag sections into the order you walk <b className="font-medium text-foreground">{list.name}</b>. A new item goes
          into the section with a word that matches its name. When you move an item to another section, this list
          remembers for next time.
        </p>

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={draft.map((s) => s.id)} strategy={verticalListSortingStrategy}>
            <div className="overflow-hidden rounded-xl bg-card shadow-sm">
              {draft.map((s, i) => (
                <SectionRow
                  key={s.id}
                  section={s}
                  last={i === draft.length - 1}
                  color={color}
                  count={counts[s.id] ?? 0}
                  expanded={expanded === s.id}
                  onToggle={() => setExpanded(expanded === s.id ? null : s.id)}
                  onRename={(name) => patch(s.id, { name })}
                  onAddKeyword={(w) => addKeyword(s.id, w)}
                  onRemoveKeyword={(w) => patch(s.id, { keywords: s.keywords.filter((k) => k !== w) })}
                  confirmingDelete={confirmDelete === s.id}
                  otherName={otherName}
                  onDelete={() => {
                    if (confirmDelete !== s.id) return setConfirmDelete(s.id);
                    setDraft((d) => d.filter((x) => x.id !== s.id));
                    setConfirmDelete(null);
                  }}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>

        <Button variant="ghost" className="w-full" style={{ color }} onClick={addSection}>
          <Plus /> Add Section
        </Button>
      </div>
    </Sheet>
  );
}

function SectionRow({
  section,
  last,
  color,
  count,
  expanded,
  onToggle,
  onRename,
  onAddKeyword,
  onRemoveKeyword,
  confirmingDelete,
  otherName,
  onDelete,
}: {
  section: ListSection;
  last: boolean;
  color: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  onRename: (name: string) => void;
  onAddKeyword: (w: string) => void;
  onRemoveKeyword: (w: string) => void;
  confirmingDelete: boolean;
  otherName: string;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: section.id });
  const [word, setWord] = useState("");
  const isOther = section.id === OTHER;
  const words = [...section.keywords].map((k) => k.trim()).sort((a, b) => a.localeCompare(b));

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("relative bg-card", isDragging && "z-10 shadow-lg", !last && "border-b")}
    >
      <div className="flex items-center gap-1 py-1 pr-2 pl-1">
        <span {...attributes} {...listeners} className="touch-none p-2 text-muted-foreground" aria-label={`Move ${section.name}`}>
          <GripVertical className="size-5" />
        </span>
        <input
          value={section.name}
          onChange={(e) => onRename(e.target.value)}
          placeholder="Section name"
          autoFocus={!section.name}
          className="min-w-0 flex-1 bg-transparent py-2 text-[17px] outline-none placeholder:text-muted-foreground/60"
        />
        <button onClick={onToggle} className="flex items-center gap-1 rounded-full px-2 py-1.5 text-xs text-muted-foreground active:bg-accent">
          {isOther ? "Everything else" : `${section.keywords.length} word${section.keywords.length === 1 ? "" : "s"}`}
          <ChevronDown className={cn("size-4 transition-transform", expanded && "rotate-180")} />
        </button>
      </div>

      {expanded && (
        <div className="space-y-3 px-4 pb-4">
          {isOther && (
            <p className="text-sm text-muted-foreground">Anything that doesn't match another section lands here. You can rename it but not delete it.</p>
          )}
          {words.length > 0 && (
            <div className="flex max-h-56 flex-wrap gap-1.5 overflow-y-auto">
              {words.map((w) => (
                <span key={w} className="flex items-center gap-0.5 rounded-full bg-muted py-1 pr-1 pl-2.5 text-sm">
                  {w}
                  <button aria-label={`Remove ${w}`} onClick={() => onRemoveKeyword(section.keywords.find((k) => k.trim() === w)!)}
                    className="rounded-full p-0.5 text-muted-foreground active:bg-accent">
                    <X className="size-3.5" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              onAddKeyword(word);
              setWord("");
            }}
          >
            <input
              value={word}
              onChange={(e) => setWord(e.target.value)}
              placeholder={`Add a word, e.g. "${section.name.toLowerCase().includes("frozen") ? "edamame" : "oat milk"}"`}
              autoCapitalize="off"
              className="min-w-0 flex-1 rounded-lg bg-muted px-3 py-2 text-[16px] outline-none placeholder:text-muted-foreground/60"
            />
            <Button type="submit" size="sm" className="h-auto" disabled={!word.trim()} style={{ backgroundColor: color }}>
              Add
            </Button>
          </form>
          {!isOther && (
            <button onClick={onDelete} className="flex items-center gap-1.5 text-sm text-destructive">
              <Trash2 className="size-4" />
              {confirmingDelete
                ? `Tap again to delete${count ? `: ${count} item${count === 1 ? "" : "s"} move to ${otherName}` : ""}`
                : "Delete section"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
