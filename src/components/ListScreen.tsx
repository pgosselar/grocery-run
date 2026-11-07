import { useEffect, useMemo, useRef, useState } from "react";
import { ChefHat, ChevronLeft, Ellipsis, Eye, EyeOff, History, Info, LayoutList, Plus, Rows3, Trash2 } from "lucide-react";
import { DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { Item } from "../../shared/types";
import { addItem, clearCompleted, itemHistory, listItems, reorderItems, updateList, useStore } from "@/lib/store";
import { goBack } from "@/lib/router";
import { LIST_COLORS } from "@/lib/colors";
import { sectionRank } from "@/lib/sections";
import { safeStorage, saveStorage } from "@/lib/utils";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ItemRow } from "./ItemRow";
import { ItemDetail } from "./ItemDetail";
import { ListEditor } from "./ListEditor";
import { HistorySheet } from "./HistorySheet";
import { RecipeImportSheet } from "./RecipeImportSheet";
import { SyncBadge } from "./SyncBadge";

const LINGER_MS = 1600;

export function ListScreen({ id }: { id: string }) {
  const state = useStore();
  const list = state.lists[id];
  const items = useMemo(() => listItems(state, id), [state.items, id]);
  const history = useMemo(() => itemHistory(state), [state.items]);

  const showKey = `gr.showCompleted.${id}`;
  const [showCompleted, setShowCompletedRaw] = useState(() => safeStorage(showKey, false));
  const setShowCompleted = (v: boolean) => {
    setShowCompletedRaw(v);
    saveStorage(showKey, v);
  };

  // Items checked off moments ago stay visible briefly, like Reminders.
  const [lingering, setLingering] = useState<Set<string>>(new Set());
  const onCompleted = (itemId: string) => {
    setLingering((s) => new Set(s).add(itemId));
    setTimeout(() => setLingering((s) => { const n = new Set(s); n.delete(itemId); return n; }), LINGER_MS);
  };

  const [adding, setAdding] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  // undefined = closed, null = whole list, string = a section
  const [historyFor, setHistoryFor] = useState<string | null | undefined>(undefined);
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    if (state.loaded && !list) goBack();
  }, [state.loaded, list]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 6 } }),
  );

  if (!list) return null;
  const color = LIST_COLORS[list.color];

  const visible = items.filter((i) => !i.completed || showCompleted || lingering.has(i.id));
  const completedCount = items.filter((i) => i.completed).length;
  const openCount = items.length - completedCount;

  const groups: { section: string; items: Item[] }[] = [];
  if (list.grouped) {
    const by = new Map<string, Item[]>();
    for (const i of visible) by.set(i.section, [...(by.get(i.section) ?? []), i]);
    [...by.entries()]
      .sort((a, b) => sectionRank(a[0]) - sectionRank(b[0]))
      .forEach(([section, its]) => groups.push({ section, items: sortItems(its) }));
  } else {
    groups.push({ section: "", items: visible });
  }

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const ids = items.map((i) => i.id);
    reorderItems(arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id))));
  };

  const openTitles = new Set(items.filter((i) => !i.completed).map((i) => i.title.toLowerCase()));

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col">
      <header className="pt-safe sticky top-0 z-10 bg-background/85 px-2 pb-1 backdrop-blur-xl">
        <div className="flex h-10 items-center justify-between">
          <button className="flex items-center text-[17px]" style={{ color }} onClick={goBack}>
            <ChevronLeft className="size-7" strokeWidth={2.25} /> Lists
          </button>
          <div className="flex items-center gap-2">
            <SyncBadge />
            <DropdownMenu>
              <DropdownMenuTrigger
                className="flex size-9 items-center justify-center rounded-full outline-none"
                style={{ color }}
                aria-label="List options"
              >
                <Ellipsis className="size-6" />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onSelect={() => setInfoOpen(true)}>
                  List Info <Info />
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => updateList(id, { grouped: !list.grouped })}>
                  {list.grouped ? "Ungroup Sections" : "Group by Section"}
                  {list.grouped ? <Rows3 /> : <LayoutList />}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setImportOpen(true)}>
                  Import Recipe <ChefHat />
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setHistoryFor(null)}>
                  Recently Completed <History />
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setShowCompleted(!showCompleted)}>
                  {showCompleted ? "Hide Completed" : "Show Completed"}
                  {showCompleted ? <EyeOff /> : <Eye />}
                </DropdownMenuItem>
                <DropdownMenuItem destructive disabled={!completedCount} onSelect={() => clearCompleted(id)}>
                  Clear {completedCount || ""} Completed <Trash2 />
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <main className="flex flex-1 flex-col px-4 pb-28">
        <h1 className="px-1 text-[34px] leading-tight font-bold tracking-tight" style={{ color }}>
          {list.name}
        </h1>
        <div className="flex items-center justify-between px-1 pt-0.5 pb-3 text-sm text-muted-foreground">
          <span>{openCount === 0 ? "Nothing to get" : `${openCount} to get`}</span>
          <span className="flex items-center gap-3">
            {completedCount > 0 && (
              <>
                <span>{completedCount} Completed</span>
                <button style={{ color }} onClick={() => setShowCompleted(!showCompleted)}>
                  {showCompleted ? "Hide" : "Show"}
                </button>
              </>
            )}
            <button className="flex items-center gap-1" style={{ color }} onClick={() => setHistoryFor(null)}>
              <History className="size-4" /> History
            </button>
          </span>
        </div>

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={visible.map((i) => i.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-5">
              {groups.map((g) => (
                <section key={g.section || "all"}>
                  <div className="mb-1.5 flex items-center justify-between px-1">
                    <h2 className="text-[15px] font-semibold" style={{ color }}>
                      {g.section || (g.items.length ? "Items" : "")}
                    </h2>
                    {(g.section || g.items.length > 0) && (
                      <button
                        onClick={() => setHistoryFor(g.section || null)}
                        aria-label={`Recently completed${g.section ? ` in ${g.section}` : ""}`}
                        className="-mr-1 flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium text-muted-foreground active:bg-accent"
                      >
                        <History className="size-4" /> History
                      </button>
                    )}
                  </div>
                  <div className="overflow-hidden rounded-xl bg-card shadow-sm [&>*:last-child_.item-sep]:border-b-0">
                    {g.items.map((item) => (
                      <ItemRow
                        key={item.id}
                        item={item}
                        color={color}
                        sortable={!list.grouped}
                        onCompleted={onCompleted}
                        onInfo={() => setDetailId(item.id)}
                        onEnter={() => setAdding(true)}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </SortableContext>
        </DndContext>

        <NewItemRow
          active={adding}
          setActive={setAdding}
          color={color}
          suggestions={history.filter((t) => !openTitles.has(t.toLowerCase()))}
          onAdd={(title) => addItem(id, title)}
          onImport={() => setImportOpen(true)}
        />

        {/* Tap empty space to add, like Reminders */}
        <div className="min-h-32 flex-1" onClick={() => setAdding(true)} />
      </main>

      <ItemDetail itemId={detailId} onClose={() => setDetailId(null)} color={color} />
      <ListEditor open={infoOpen} onOpenChange={setInfoOpen} list={list} />
      <RecipeImportSheet open={importOpen} onClose={() => setImportOpen(false)} listId={id} color={color} />
      <HistorySheet listId={id} section={historyFor} onClose={() => setHistoryFor(undefined)} color={color} />
    </div>
  );
}

function sortItems(items: Item[]) {
  return [...items].sort((a, b) => Number(a.completed) - Number(b.completed) || a.position - b.position);
}

function NewItemRow({
  active,
  setActive,
  color,
  suggestions,
  onAdd,
  onImport,
}: {
  onImport: () => void;
  active: boolean;
  setActive: (v: boolean) => void;
  color: string;
  suggestions: string[];
  onAdd: (title: string) => void;
}) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (active) inputRef.current?.focus();
  }, [active]);

  const q = text.trim().toLowerCase();
  const matches = (
    q
      ? suggestions.filter((s) => s.toLowerCase().startsWith(q)).concat(
          suggestions.filter((s) => !s.toLowerCase().startsWith(q) && s.toLowerCase().includes(q)),
        )
      : suggestions
  )
    .filter((s) => s.toLowerCase() !== q)
    .slice(0, 8);

  const submit = (value = text) => {
    if (value.trim()) onAdd(value);
    setText("");
  };

  if (!active) {
    return (
      <div className="mt-3 flex items-center justify-between">
        <button
          className="flex items-center gap-3 px-3 py-2 text-[17px] font-medium"
          style={{ color }}
          onClick={() => setActive(true)}
        >
          <Plus className="size-6 rounded-full p-0.5 text-white" style={{ backgroundColor: color }} strokeWidth={3} />
          New Item
        </button>
        <button
          className="flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium"
          style={{ color }}
          onClick={onImport}
        >
          <ChefHat className="size-4.5" /> From Recipe
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3">
      <div className="flex items-center gap-3 rounded-xl bg-card px-3 py-2.5 shadow-sm">
        <span className="size-6 shrink-0 rounded-full border-2 border-muted-foreground/40" />
        <input
          ref={inputRef}
          value={text}
          enterKeyHint="next"
          autoCapitalize="sentences"
          placeholder="Add an item"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (!text.trim()) setActive(false);
              else submit();
            } else if (e.key === "Escape") {
              setText("");
              setActive(false);
            }
          }}
          onBlur={() => {
            submit();
            setActive(false);
          }}
          className="flex-1 bg-transparent text-[17px] outline-none placeholder:text-muted-foreground/60"
        />
      </div>
      {matches.length > 0 && (
        <div className="-mx-4 mt-2 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
          {matches.map((s) => (
            <button
              key={s}
              // Keep the input focused (and the keyboard up) while tapping chips.
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => {
                submit(s);
                inputRef.current?.focus();
              }}
              className="shrink-0 rounded-full border bg-card px-3.5 py-1.5 text-sm"
            >
              <span style={{ color }}>+</span> {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

