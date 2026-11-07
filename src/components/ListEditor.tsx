import { useEffect, useState } from "react";
import { Check, Trash2 } from "lucide-react";
import type { GroceryList, ListColor } from "../../shared/types";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { COLOR_NAMES, LIST_COLORS } from "@/lib/colors";
import { LIST_ICONS, ListIcon } from "@/lib/icons";
import { createList, deleteList, updateList } from "@/lib/store";
import { cn } from "@/lib/utils";

export function ListEditor({
  open,
  onOpenChange,
  list,
  onCreated,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  list?: GroceryList;
  onCreated?: (id: string) => void;
  onDeleted?: () => void;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<ListColor>("theme");
  const [icon, setIcon] = useState("cart");
  const [grouped, setGrouped] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(list?.name ?? "");
    setColor(list?.color ?? "theme");
    setIcon(list?.icon ?? "cart");
    setGrouped(list?.grouped ?? true);
    setConfirmDelete(false);
  }, [open, list]);

  const save = () => {
    const n = name.trim();
    if (!n) return;
    if (list) updateList(list.id, { name: n, color, icon, grouped });
    else onCreated?.(createList({ name: n, color, icon, grouped }));
    onOpenChange(false);
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={list ? "List Info" : "New List"}
      onDone={save}
      doneDisabled={!name.trim()}
    >
      <div className="space-y-4 pb-4">
        <div className="flex flex-col items-center gap-4 rounded-xl bg-card p-5">
          <div
            className="flex size-20 items-center justify-center rounded-full text-white shadow-lg"
            style={{ backgroundColor: LIST_COLORS[color], boxShadow: `0 8px 24px -8px color-mix(in oklab, ${LIST_COLORS[color]} 70%, transparent)` }}
          >
            <ListIcon name={icon} className="size-10" />
          </div>
          <input
            autoFocus={!list}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
            placeholder="List Name"
            className="w-full rounded-lg bg-muted px-3 py-3 text-center text-xl font-bold outline-none placeholder:text-muted-foreground/60"
            style={{ color: LIST_COLORS[color] }}
          />
        </div>

        <div className="grid grid-cols-6 gap-3 rounded-xl bg-card p-4">
          {COLOR_NAMES.map((c) => (
            <button
              key={c}
              aria-label={c}
              onClick={() => setColor(c)}
              className={cn(
                "mx-auto flex size-10 items-center justify-center rounded-full ring-offset-2 ring-offset-card transition",
                color === c && "ring-3 ring-muted-foreground/40",
              )}
              style={{ backgroundColor: LIST_COLORS[c] }}
            >
              {color === c && <Check className="size-5 text-white" strokeWidth={3} />}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-6 gap-3 rounded-xl bg-card p-4">
          {Object.keys(LIST_ICONS).map((k) => (
            <button
              key={k}
              aria-label={k}
              onClick={() => setIcon(k)}
              className={cn(
                "mx-auto flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground transition",
                icon === k && "text-white",
              )}
              style={icon === k ? { backgroundColor: LIST_COLORS[color] } : undefined}
            >
              <ListIcon name={k} className="size-5" />
            </button>
          ))}
        </div>

        <label className="flex items-center justify-between rounded-xl bg-card p-4">
          <div>
            <div className="font-medium">Group by store section</div>
            <div className="text-sm text-muted-foreground">Sort items into Produce, Dairy, Bakery…</div>
          </div>
          <Toggle checked={grouped} onChange={setGrouped} color={LIST_COLORS[color]} />
        </label>

        {list &&
          (confirmDelete ? (
            <div className="space-y-2 rounded-xl bg-card p-4">
              <p className="text-sm text-muted-foreground">Delete “{list.name}” and all its items for everyone?</p>
              <div className="flex gap-2">
                <Button variant="secondary" className="flex-1" onClick={() => setConfirmDelete(false)}>
                  Keep
                </Button>
                <Button
                  variant="destructive"
                  className="flex-1"
                  onClick={() => {
                    deleteList(list.id);
                    onOpenChange(false);
                    onDeleted?.();
                  }}
                >
                  Delete List
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="ghost" className="w-full text-destructive" onClick={() => setConfirmDelete(true)}>
              <Trash2 /> Delete List
            </Button>
          ))}
      </div>
    </Sheet>
  );
}

export function Toggle({
  checked,
  onChange,
  color,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  color?: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={(e) => {
        e.preventDefault();
        onChange(!checked);
      }}
      className={cn("relative h-7.5 w-12.5 shrink-0 rounded-full transition-colors", !checked && "bg-muted-foreground/25")}
      style={checked ? { backgroundColor: color ?? "var(--primary)" } : undefined}
    >
      <span
        className={cn(
          "absolute top-0.5 left-0.5 size-6.5 rounded-full bg-white shadow transition-transform",
          checked && "translate-x-5",
        )}
      />
    </button>
  );
}
