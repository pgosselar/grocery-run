import { useEffect, useState } from "react";
import { Flag, GripVertical, Info, Pencil, Trash2 } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Item } from "../../shared/types";
import { deleteItem, toggleItem, updateItem } from "@/lib/store";
import { cn } from "@/lib/utils";
import { SwipeRow } from "./SwipeRow";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Provenance } from "./Provenance";

export function ItemRow({
  item,
  color,
  sortable,
  onCompleted,
  onInfo,
  onEnter,
}: {
  item: Item;
  color: string;
  sortable: boolean;
  onCompleted: (id: string) => void;
  onInfo: () => void;
  onEnter: () => void;
}) {
  const [title, setTitle] = useState(item.title);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setTitle(item.title);
  }, [item.title, focused]);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled: !sortable,
  });

  const commitTitle = () => {
    const t = title.trim();
    if (!t) deleteItem(item.id);
    else if (t !== item.title) updateItem(item.id, { title: t });
  };

  const meta = [item.quantity && `Qty ${item.quantity}`, item.notes].filter(Boolean).join(" · ");

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("relative", isDragging && "z-10 shadow-lg")}
    >
      <SwipeRow
        actions={[
          {
            label: item.flagged ? "Unflag" : "Flag",
            icon: <Flag />,
            className: "bg-orange-500",
            onAction: () => updateItem(item.id, { flagged: !item.flagged }),
          },
          { label: "Delete", icon: <Trash2 />, className: "bg-red-500", onAction: () => deleteItem(item.id) },
        ]}
      >
        <div className="group flex items-start gap-3 pl-3">
          <button
            aria-label={item.completed ? "Mark as not done" : "Mark as done"}
            className="mt-2.5 flex size-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors"
            style={{ borderColor: item.completed ? color : "color-mix(in oklab, var(--muted-foreground) 45%, transparent)" }}
            onClick={() => {
              if (!item.completed) onCompleted(item.id);
              toggleItem(item.id);
            }}
          >
            {item.completed && (
              <span key="dot" className="animate-check size-3.5 rounded-full" style={{ backgroundColor: color }} />
            )}
          </button>
          <div className="flex min-w-0 flex-1 items-start gap-2 item-sep border-b py-2.5 pr-3">
            <div className="min-w-0 flex-1">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onFocus={() => setFocused(true)}
                onBlur={() => {
                  setFocused(false);
                  commitTitle();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    (e.target as HTMLInputElement).blur();
                    onEnter();
                  }
                }}
                enterKeyHint="next"
                className={cn(
                  "w-full bg-transparent text-[17px] leading-6 outline-none",
                  item.completed && "text-muted-foreground",
                )}
              />
              {meta && <div className="truncate text-sm text-muted-foreground">{meta}</div>}
            </div>
            {item.flagged && <Flag className="mt-1 size-4 shrink-0 fill-orange-500 text-orange-500" />}
            <Popover>
              <PopoverTrigger
                aria-label={`Who added ${item.title}`}
                onPointerDown={(e) => e.preventDefault()}
                className="mt-0.5 shrink-0 rounded-full p-0.5 opacity-70 outline-none transition-opacity hover:opacity-100 data-[state=open]:opacity-100"
                style={{ color }}
              >
                <Info className="size-5.5" />
              </PopoverTrigger>
              <PopoverContent>
                <div className="mb-3 truncate font-semibold">{item.title}</div>
                <Provenance
                  addedBy={item.addedBy}
                  createdAt={item.createdAt}
                  completedBy={item.completedBy}
                  completedAt={item.completed ? item.completedAt : null}
                  color={color}
                />
                <PopoverClose
                  onClick={onInfo}
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-muted py-2 text-sm font-medium"
                  style={{ color }}
                >
                  <Pencil className="size-4" /> Edit Details
                </PopoverClose>
              </PopoverContent>
            </Popover>
            {sortable && (
              <span
                {...attributes}
                {...listeners}
                aria-label="Reorder"
                className="mt-0.5 shrink-0 touch-none p-0.5 text-muted-foreground/50"
              >
                <GripVertical className="size-5" />
              </span>
            )}
          </div>
        </div>
      </SwipeRow>
    </div>
  );
}
