import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, BookOpen, Check, ChefHat, Link2, Loader2, Sparkles, TextCursorInput } from "lucide-react";
import type { Recipe, RecipeImport } from "../../shared/types";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { addItem, listItems, requestRecipeImport, sortedLists, useStore } from "@/lib/store";
import { recipeShopping, saveRecipe, tagRecipe } from "@/lib/recipes";
import { sectionRank } from "@/lib/sections";
import { LIST_COLORS } from "@/lib/colors";
import { navigate } from "@/lib/router";
import { showToast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { Toggle } from "./ListEditor";

type Row = RecipeImport["ingredients"][number] & { key: number; selected: boolean; onList: boolean };

/**
 * Import a recipe (link or paste) into a list and save it to the recipe box, or, with `recipeId`, add a saved
 * recipe's ingredients to a list again. Without `listId` (opened from the recipe box), there's a list picker.
 */
export function RecipeImportSheet({
  open,
  onClose,
  listId,
  recipeId,
  onTagged,
}: {
  open: boolean;
  onClose: () => void;
  listId?: string;
  recipeId?: string;
  /** Re-adding tags the recipe with the list; this gets the updated recipe */
  onTagged?: (r: Recipe) => void;
}) {
  const state = useStore();
  const lists = sortedLists(state);
  const [target, setTarget] = useState("");
  const [mode, setMode] = useState<"url" | "text">("url");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recipe, setRecipe] = useState<RecipeImport | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [save, setSave] = useState(true);
  const urlRef = useRef<HTMLInputElement>(null);
  const list = state.lists[target];
  const sections = list?.sections ?? [];
  const color = list ? LIST_COLORS[list.color] : "var(--primary)";
  const readding = !!recipeId;
  const pickList = !listId;

  useEffect(() => {
    if (!open) return;
    setTarget(listId ?? lists[0]?.id ?? "");
    setRecipe(null);
    setRows([]);
    setError(null);
    setLoading(false);
    setSave(true);
  }, [open]);

  const openTitles = useMemo(
    () => new Set(listItems(state, target).filter((i) => !i.completed).map((i) => i.title.toLowerCase())),
    [state.items, target],
  );

  const show = (r: RecipeImport) => {
    setRecipe(r);
    setRows(
      r.ingredients
        .map((ing, key) => {
          const onList = openTitles.has(ing.title.toLowerCase());
          return { ...ing, key, onList, selected: !ing.staple && !onList };
        })
        .sort((a, b) => sectionRank(sections, a.section) - sectionRank(sections, b.section)),
    );
  };

  // Re-adding a saved recipe: fetch its shopping items sorted for the chosen list.
  useEffect(() => {
    if (!open || !recipeId || !target) return;
    let live = true;
    setLoading(true);
    setError(null);
    recipeShopping(recipeId, target)
      .then((r) => live && show(r))
      .catch((e: Error) => live && setError(e.message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [open, recipeId, target]);

  const fetchRecipe = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await requestRecipeImport(mode === "url" ? { listId: target, url } : { listId: target, text });
      show(r);
      if (!r.ingredients.length && !r.draft?.steps.length) setError("Found the recipe, but no ingredients in it.");
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

  const willSave = !readding && save && !!recipe?.draft;

  const finish = () => {
    if (!recipe || !list) return onClose();
    const source = recipe.name && recipe.name !== "Pasted recipe" ? `For ${recipe.name}` : "";
    for (const r of selected) {
      const notes = [r.notes, source].filter(Boolean).join(" · ");
      addItem(target, r.title, { quantity: r.quantity, section: r.section, notes });
    }
    const added = selected.length ? `Added ${selected.length} item${selected.length === 1 ? "" : "s"} to ${list.name}` : "";
    onClose();

    if (readding) {
      tagRecipe(recipeId!, target).then((r) => onTagged?.(r)).catch(() => {});
      if (added) showToast(`${added}.`);
    } else if (willSave) {
      saveRecipe(recipe.draft!, target)
        .then(({ id, existing }) => {
          const saved = existing ? `“${recipe.name}” was already in Recipes` : `Saved “${recipe.name}” to Recipes`;
          showToast(added ? `${added}. ${saved}.` : `${saved}.`, { label: "View", run: () => navigate({ name: "recipe", id }) });
        })
        .catch(() => showToast(`${added ? `${added}, but the` : "The"} recipe couldn't be saved. Check your connection.`));
    }
  };

  const canFetch = !!target && (mode === "url" ? /^https?:\/\/\S+\.\S+/i.test(url.trim()) : text.trim().length > 2);

  const listPicker = (
    <label className="flex items-center justify-between gap-3 rounded-xl bg-card px-4 py-2.5 shadow-sm">
      <span className="text-[16px]">Add to</span>
      <select
        value={target}
        onChange={(e) => setTarget(e.target.value)}
        disabled={loading}
        className="max-w-52 bg-transparent text-right font-medium outline-none"
        style={{ color }}
      >
        {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
      </select>
    </label>
  );

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={recipe || readding ? "Add Ingredients" : "Import Recipe"}
      onDone={recipe ? finish : fetchRecipe}
      doneLabel={recipe ? (selected.length || !willSave ? `Add ${selected.length}` : "Save") : loading ? "…" : "Next"}
      doneDisabled={recipe ? selected.length === 0 && !willSave : !canFetch || loading}
    >
      {!recipe ? (
        <div className="space-y-4 pb-4">
          {pickList && listPicker}
          {readding ? (
            error ? (
              <p className="flex gap-2 rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {error}
              </p>
            ) : (
              <div className="flex justify-center py-10"><Loader2 className="size-7 animate-spin text-muted-foreground" /></div>
            )
          ) : (
            <>
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
                    {m === "url" ? "Recipe link" : "Paste recipe"}
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
                  rows={9}
                  placeholder={"Banana Bread\n\nIngredients\n2 cups flour\n3 ripe bananas, mashed\n\nDirections\n1. Heat the oven to 350°F…"}
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
                {mode === "url"
                  ? "Works with many recipe sites. Some big ones refuse automatic readers; for those, copy the recipe and paste it."
                  : "Paste a whole recipe (title, ingredients and steps) to save it, or just the ingredients."}
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-3 pb-4">
          {readding && pickList && listPicker}
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
                {!readding && <span>{list?.name}</span>}
                {recipe.cleanedBy === "claude" && (
                  <span className="flex items-center gap-1" style={{ color }}>
                    <Sparkles className="size-3.5" /> Smart cleanup
                  </span>
                )}
              </div>
            </div>
          </div>

          {!readding && recipe.draft && (
            <div className="rounded-xl bg-card px-4 py-2.5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-[16px]">
                  <BookOpen className="size-4.5" style={{ color }} /> Save to Recipes
                </span>
                <Toggle checked={save} onChange={setSave} color={color} />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {recipe.existingId
                  ? `Already in Recipes. Saving tags it with ${list?.name} too.`
                  : `${recipe.draft.steps.length ? `With its ${recipe.draft.steps.filter((s) => !s.heading).length} steps. ` : ""}Everyone on ${list?.name} can find it and cook from it.`}
              </p>
            </div>
          )}

          {recipe.warning && (
            <p className="flex gap-2 rounded-lg bg-muted px-3 py-2.5 text-sm text-muted-foreground">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {recipe.warning}
            </p>
          )}

          {rows.length > 0 && (
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
          )}

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
                      {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                    {r.onList && <span className="rounded bg-muted px-1.5 py-0.5" style={{ color }}>Already on list</span>}
                    {r.staple && !r.onList && <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">Pantry staple</span>}
                    {r.notes && <span className="truncate text-muted-foreground">{r.notes}</span>}
                  </div>
                  {r.original && (
                    <details className="mt-1 text-xs text-muted-foreground/80">
                      <summary className="cursor-pointer select-none">Recipe line</summary>
                      <p className="mt-1 whitespace-pre-line">{r.original}</p>
                    </details>
                  )}
                </div>
              </li>
            ))}
          </ul>

          {!readding && (
            <Button variant="ghost" className="w-full" onClick={() => setRecipe(null)}>
              Try a different recipe
            </Button>
          )}
        </div>
      )}
    </Sheet>
  );
}
