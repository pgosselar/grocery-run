import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, ChefHat, Link2, Loader2, Sparkles, TextCursorInput } from "lucide-react";
import type { RecipeImport } from "../../shared/types";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { addItem, listItems, requestRecipeImport, useStore } from "@/lib/store";
import { SECTIONS, sectionRank } from "@/lib/sections";
import { cn } from "@/lib/utils";

type Row = RecipeImport["ingredients"][number] & { key: number; selected: boolean; onList: boolean };

export function RecipeImportSheet({
  open,
  onClose,
  listId,
  color,
}: {
  open: boolean;
  onClose: () => void;
  listId: string;
  color: string;
}) {
  const state = useStore();
  const [mode, setMode] = useState<"url" | "text">("url");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recipe, setRecipe] = useState<RecipeImport | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const urlRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setRecipe(null);
    setRows([]);
    setError(null);
    setLoading(false);
    // Pre-fill a recipe link that's on the clipboard? Needs a permission prompt on iOS, so no.
  }, [open]);

  const openTitles = useMemo(
    () => new Set(listItems(state, listId).filter((i) => !i.completed).map((i) => i.title.toLowerCase())),
    [state.items, listId],
  );

  const fetchRecipe = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await requestRecipeImport(mode === "url" ? { url } : { text });
      setRecipe(r);
      setRows(
        r.ingredients
          .map((ing, key) => {
            const onList = openTitles.has(ing.title.toLowerCase());
            return { ...ing, key, onList, selected: !ing.staple && !onList };
          })
          .sort((a, b) => sectionRank(a.section) - sectionRank(b.section)),
      );
      if (!r.ingredients.length) setError("Found the recipe, but no ingredients in it.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't import that recipe.");
      if (mode === "url" && /paste/i.test(String(e))) setMode("text");
    } finally {
      setLoading(false);
    }
  };

  const selected = rows.filter((r) => r.selected);
  const update = (key: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const addSelected = () => {
    const source = recipe?.name && recipe.name !== "Pasted recipe" ? `For ${recipe.name}` : "";
    for (const r of selected) {
      const notes = [r.notes, source].filter(Boolean).join(" · ");
      addItem(listId, r.title, { quantity: r.quantity, section: r.section, notes });
    }
    onClose();
  };

  const canFetch = mode === "url" ? /^https?:\/\/\S+\.\S+/i.test(url.trim()) : text.trim().length > 2;

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={recipe ? "Add Ingredients" : "Import Recipe"}
      onDone={recipe ? addSelected : fetchRecipe}
      doneLabel={recipe ? `Add ${selected.length}` : loading ? "…" : "Next"}
      doneDisabled={recipe ? selected.length === 0 : !canFetch || loading}
    >
      {!recipe ? (
        <div className="space-y-4 pb-4">
          <div className="flex rounded-lg bg-muted p-1 text-sm font-medium">
            {(["url", "text"] as const).map((m) => (
              <button
                key={m}
                onClick={() => {
                  setMode(m);
                  setError(null);
                  if (m === "url") setTimeout(() => urlRef.current?.focus(), 0);
                }}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded-md py-2 transition-colors",
                  mode === m ? "bg-card shadow-sm" : "text-muted-foreground",
                )}
              >
                {m === "url" ? <Link2 className="size-4" /> : <TextCursorInput className="size-4" />}
                {m === "url" ? "Recipe link" : "Paste ingredients"}
              </button>
            ))}
          </div>

          {mode === "url" ? (
            <Input
              ref={urlRef}
              autoFocus
              type="url"
              inputMode="url"
              autoCapitalize="off"
              autoCorrect="off"
              placeholder="https://…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && canFetch && !loading && fetchRecipe()}
            />
          ) : (
            <Textarea
              autoFocus
              rows={8}
              placeholder={"2 cups flour\n1 tsp baking soda\n3 ripe bananas, mashed"}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          )}

          {error && (
            <p className="flex gap-2 rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {error}
            </p>
          )}

          <Button className="w-full" size="lg" disabled={!canFetch || loading} onClick={fetchRecipe} style={{ backgroundColor: color }}>
            {loading ? <Loader2 className="animate-spin" /> : <ChefHat />}
            {loading ? "Reading the recipe…" : "Get Ingredients"}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Works with many recipe sites. Some big ones refuse automatic readers; for those, copy the ingredient list and paste it.
          </p>
        </div>
      ) : (
        <div className="space-y-3 pb-4">
          <div className="flex items-center gap-3 rounded-xl bg-card p-3 shadow-sm">
            {recipe.image ? (
              <img src={recipe.image} alt="" className="size-14 shrink-0 rounded-lg object-cover" referrerPolicy="no-referrer" />
            ) : (
              <div className="flex size-14 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <ChefHat className="size-6" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">{recipe.name}</div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {recipe.servings && <span>Serves {recipe.servings.replace(/\s*servings?/i, "")}</span>}
                {recipe.cleanedBy === "claude" && (
                  <span className="flex items-center gap-1" style={{ color }}>
                    <Sparkles className="size-3.5" /> Smart cleanup
                  </span>
                )}
              </div>
            </div>
          </div>

          {recipe.warning && (
            <p className="flex gap-2 rounded-lg bg-muted px-3 py-2.5 text-sm text-muted-foreground">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {recipe.warning}
            </p>
          )}

          <div className="flex items-center justify-between px-1 text-sm">
            <span className="text-muted-foreground">
              {selected.length} of {rows.length} selected
            </span>
            <button
              style={{ color }}
              onClick={() => {
                const all = selected.length < rows.length;
                setRows((rs) => rs.map((r) => ({ ...r, selected: all })));
              }}
            >
              {selected.length < rows.length ? "Select All" : "Select None"}
            </button>
          </div>

          <ul className="divide-y overflow-hidden rounded-xl bg-card shadow-sm">
            {rows.map((r) => (
              <li key={r.key} className="flex items-start gap-3 px-3 py-2.5">
                <button
                  aria-label={r.selected ? `Don't add ${r.title}` : `Add ${r.title}`}
                  onClick={() => update(r.key, { selected: !r.selected })}
                  className="mt-1 flex size-6 shrink-0 items-center justify-center rounded-md border-2 transition-colors"
                  style={
                    r.selected
                      ? { backgroundColor: color, borderColor: color, color: "white" }
                      : { borderColor: "color-mix(in oklab, var(--muted-foreground) 45%, transparent)" }
                  }
                >
                  {r.selected && <Check className="size-4" strokeWidth={3} />}
                </button>
                <div className={cn("min-w-0 flex-1", !r.selected && "opacity-60")}>
                  <input
                    value={r.title}
                    onChange={(e) => update(r.key, { title: e.target.value })}
                    className="w-full bg-transparent text-[16px] font-medium outline-none"
                  />
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                    <label className="flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
                      Qty
                      <input
                        value={r.quantity}
                        onChange={(e) => update(r.key, { quantity: e.target.value })}
                        placeholder="—"
                        size={Math.max(3, r.quantity.length)}
                        className="max-w-36 bg-transparent text-foreground outline-none"
                      />
                    </label>
                    <select
                      value={r.section}
                      onChange={(e) => update(r.key, { section: e.target.value })}
                      className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground outline-none"
                    >
                      {SECTIONS.map((s) => <option key={s}>{s}</option>)}
                    </select>
                    {r.onList && <span className="rounded bg-muted px-1.5 py-0.5" style={{ color }}>Already on list</span>}
                    {r.staple && !r.onList && <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">Pantry staple</span>}
                    {r.notes && <span className="truncate text-muted-foreground">{r.notes}</span>}
                  </div>
                  <details className="mt-1 text-xs text-muted-foreground/80">
                    <summary className="cursor-pointer select-none">Recipe line</summary>
                    <p className="mt-1 whitespace-pre-line">{r.original}</p>
                  </details>
                </div>
              </li>
            ))}
          </ul>

          <Button variant="ghost" className="w-full" onClick={() => setRecipe(null)}>
            Try a different recipe
          </Button>
        </div>
      )}
    </Sheet>
  );
}
