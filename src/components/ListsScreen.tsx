import { useMemo, useState } from "react";
import { BookOpen, ChevronRight, GripVertical, Info, Plus, ShoppingBasket, Users } from "lucide-react";
import { DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { GroceryList } from "../../shared/types";
import { reorderLists, sortedLists, useStore } from "@/lib/store";
import { navigate } from "@/lib/router";
import { LIST_COLORS } from "@/lib/colors";
import { ListIcon } from "@/lib/icons";
import { ListEditor } from "./ListEditor";
import { AccountSheet } from "./AccountSheet";
import { Avatar } from "./ShareSheet";
import { SyncBadge } from "./SyncBadge";
import { cn } from "@/lib/utils";

export function ListsScreen() {
  const state = useStore();
  const lists = useMemo(() => sortedLists(state), [state.lists]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const i of Object.values(state.items)) if (!i.completed) c[i.listId] = (c[i.listId] ?? 0) + 1;
    return c;
  }, [state.items]);
  const totalOpen = Object.values(counts).reduce((a, b) => a + b, 0);
  const [editing, setEditing] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editList, setEditList] = useState<GroceryList | undefined>();
  const [accountOpen, setAccountOpen] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 6 } }),
  );

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const ids = lists.map((l) => l.id);
    reorderLists(arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id))));
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col">
      <header className="pt-safe sticky top-0 z-10 bg-background/85 px-4 pb-2 backdrop-blur-xl">
        <div className="flex h-10 items-center justify-between gap-2">
          <button aria-label="Account" onClick={() => setAccountOpen(true)} className="rounded-full active:opacity-70">
            <Avatar name={state.user?.name ?? ""} color="var(--primary)" className="size-8" />
          </button>
          <SyncBadge />
          <div className="flex-1" />
          {lists.length > 0 && (
            <button className="text-primary text-[17px]" onClick={() => setEditing((e) => !e)}>
              {editing ? "Done" : "Edit"}
            </button>
          )}
        </div>
        <h1 className="text-[34px] leading-tight font-bold tracking-tight">Groceries</h1>
        {lists.length > 0 && (
          <p className="text-sm text-muted-foreground">
            {totalOpen === 0 ? "All caught up" : `${totalOpen} item${totalOpen === 1 ? "" : "s"} to get`}
          </p>
        )}
      </header>

      <main className="flex-1 px-4 pt-3 pb-28">
        {state.loaded && lists.length === 0 ? (
          <EmptyState onCreate={() => { setEditList(undefined); setEditorOpen(true); }} />
        ) : (
          <>
            <h2 className="mb-2 px-1 text-xl font-bold">My Lists</h2>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={lists.map((l) => l.id)} strategy={verticalListSortingStrategy}>
                <div className="overflow-hidden rounded-xl bg-card shadow-sm">
                  {lists.map((l, idx) => (
                    <ListRow
                      key={l.id}
                      list={l}
                      count={counts[l.id] ?? 0}
                      sharedWith={(state.members[l.id]?.length ?? 1) - 1}
                      editing={editing}
                      last={idx === lists.length - 1}
                      onInfo={() => { setEditList(l); setEditorOpen(true); }}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>

            <h2 className="mt-7 mb-2 px-1 text-xl font-bold">Cooking</h2>
            <button
              className="flex w-full items-center gap-3 rounded-xl bg-card py-2.5 pr-3 pl-3 text-left shadow-sm active:bg-accent"
              onClick={() => navigate({ name: "recipes" })}
            >
              <span className="bg-primary flex size-8.5 shrink-0 items-center justify-center rounded-full text-white">
                <BookOpen className="size-4.5" />
              </span>
              <span className="flex-1 py-1.5 text-[17px]">Recipes</span>
              <ChevronRight className="size-5 text-muted-foreground/60" />
            </button>
          </>
        )}
      </main>

      <footer className="pb-safe fixed inset-x-0 bottom-0 z-10 bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-2xl justify-end px-4 pt-3">
          <button
            className="text-primary flex items-center gap-1.5 text-[17px] font-medium"
            onClick={() => { setEditList(undefined); setEditorOpen(true); }}
          >
            <Plus className="size-5" strokeWidth={2.5} /> Add List
          </button>
        </div>
      </footer>

      <AccountSheet open={accountOpen} onClose={() => setAccountOpen(false)} />
      <ListEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        list={editList}
        onCreated={(id) => navigate({ name: "list", id })}
      />
    </div>
  );
}

function ListRow({
  list,
  count,
  sharedWith,
  editing,
  last,
  onInfo,
}: {
  list: GroceryList;
  count: number;
  sharedWith: number;
  editing: boolean;
  last: boolean;
  onInfo: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: list.id,
    disabled: !editing,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("relative bg-card", isDragging && "z-10 shadow-lg")}
    >
      <button
        className="flex w-full items-center gap-3 py-2.5 pl-3 text-left active:bg-accent"
        onClick={() => (editing ? onInfo() : navigate({ name: "list", id: list.id }))}
      >
        <span
          className="flex size-8.5 shrink-0 items-center justify-center rounded-full text-white"
          style={{ backgroundColor: LIST_COLORS[list.color] }}
        >
          <ListIcon name={list.icon} className="size-4.5" />
        </span>
        <span className={cn("flex flex-1 items-center gap-2 py-1.5 pr-3", !last && "border-b")}>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[17px]">{list.name}</span>
            {sharedWith > 0 && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Users className="size-3.5" /> Shared with {sharedWith}
              </span>
            )}
          </span>
          {editing ? (
            <>
              <Info className="text-primary size-5.5" />
              <span
                {...attributes}
                {...listeners}
                onClick={(e) => e.stopPropagation()}
                className="touch-none p-1 text-muted-foreground"
                aria-label="Reorder"
              >
                <GripVertical className="size-5" />
              </span>
            </>
          ) : (
            <>
              <span className="text-[17px] text-muted-foreground tabular-nums">{count}</span>
              <ChevronRight className="size-5 text-muted-foreground/60" />
            </>
          )}
        </span>
      </button>
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center px-6 pt-20 text-center">
      <div className="bg-primary/10 text-primary mb-5 flex size-20 items-center justify-center rounded-full">
        <ShoppingBasket className="size-10" />
      </div>
      <h2 className="text-xl font-semibold">No lists yet</h2>
      <p className="mt-1 text-muted-foreground">
        Make a list for each store: the weekly shop, Costco, Trader Joe's… Each one gets its own sections, and you can share
        it with family.
      </p>
      <button onClick={onCreate} className="bg-primary text-primary-foreground mt-6 rounded-full px-6 py-3 font-medium">
        Create a List
      </button>
    </div>
  );
}
