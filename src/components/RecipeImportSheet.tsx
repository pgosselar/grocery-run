import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, BookOpen, Camera, Check, ChefHat, Images, Link2, Loader2, Sparkles, TextCursorInput, X } from "lucide-react";
import type { GroceryList, Recipe, RecipeImport } from "../../shared/types";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { addItem, canReadPhotos, listItems, requestRecipeImport, sortedLists, useStore } from "@/lib/store";
import { categorize } from "@/lib/sections";
import { prepareImage, type PreparedImage } from "@/lib/images";
import { recipeShopping, saveRecipe, tagRecipe } from "@/lib/recipes";
import { sectionRank } from "@/lib/sections";
import { LIST_COLORS } from "@/lib/colors";
import { navigate } from "@/lib/router";
import { showToast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { Toggle } from "./ListEditor";

const MAX_PHOTOS = 4;

/** An ingredient as offered for adding. Each one can go to a different list (milk to Costco, herbs to the market). */
type Row = RecipeImport["ingredients"][number] & { key: number; selected: boolean; listId: string };

/** The section an ingredient lands in when it's sent to another list, whose sections may differ. */
function sectionOn(list: GroceryList, title: string, section: string) {
  return list.sections.some((s) => s.id === section) ? section : categorize(title, list.sections);
}

const plural = (n: number) => `${n} item${n === 1 ? "" : "s"}`;

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
  const [mode, setMode] = useState<"url" | "text" | "photo">("url");
  const [photos, setPhotos] = useState<PreparedImage[]>([]);
  const [preparing, setPreparing] = useState(false);
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
    setPhotos((ps) => {
      ps.forEach((p) => URL.revokeObjectURL(p.preview));
      return [];
    });
  }, [open]);

  const addPhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    setPreparing(true);
    setError(null);
    try {
      const room = MAX_PHOTOS - photos.length;
      const ready = await Promise.all([...files].slice(0, room).map(prepareImage));
      setPhotos((ps) => [...ps, ...ready].slice(0, MAX_PHOTOS));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't open that photo.");
    } finally {
      setPreparing(false);
    }
  };

  /** What's already waiting on each list, so a recipe doesn't add milk twice. */
  const openTitles = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const l of lists) m.set(l.id, new Set(listItems(state, l.id).filter((i) => !i.completed).map((i) => i.title.toLowerCase())));
    return m;
  }, [state.items, state.lists]);
  const isOnList = (r: Row) => !!openTitles.get(r.listId)?.has(r.title.trim().toLowerCase());

  const show = (r: RecipeImport) => {
    setRecipe(r);
    setRows(
      r.ingredients
        .map((ing, key) => {
          const onList = !!openTitles.get(target)?.has(ing.title.toLowerCase());
          return { ...ing, key, listId: target, selected: !ing.staple && !onList };
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
      const r = await requestRecipeImport(
        mode === "url"
          ? { listId: target, url }
          : mode === "text"
            ? { listId: target, text }
            : { listId: target, images: photos.map(({ data, mediaType }) => ({ data, mediaType })) },
      );
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
  const moveTo = (r: Row, listId: string) => {
    const to = state.lists[listId];
    if (to) update(r.key, { listId, section: sectionOn(to, r.title, r.section) });
  };
  const multiList = lists.length > 1;
  const rowColor = (r: Row) => {
    const l = state.lists[r.listId];
    return l ? LIST_COLORS[l.color] : color;
  };

  const willSave = !readding && save && !!recipe?.draft;
  /** Where the selected ingredients are headed: "Costco", or "Costco and Trader Joe's". */
  const destinations = lists.filter((l) => selected.some((r) => r.listId === l.id)).map((l) => l.name);
  const destText = (destinations.length ? destinations : [list?.name ?? ""])
    .reduce((acc, n, i, all) => (i === 0 ? n : `${acc}${i === all.length - 1 ? " and " : ", "}${n}`), "");

  const finish = () => {
    if (!recipe || !list) return onClose();
    const source = recipe.name && recipe.name !== "Pasted recipe" ? `For ${recipe.name}` : "";
    const counts = new Map<string, number>(); // list → items added, in the order the lists are shown
    for (const l of lists) counts.set(l.id, 0);
    for (const r of selected) {
      if (!state.lists[r.listId]) continue;
      const notes = [r.notes, source].filter(Boolean).join(" · ");
      addItem(r.listId, r.title, { quantity: r.quantity, section: r.section, notes });
      counts.set(r.listId, counts.get(r.listId)! + 1);
    }
    const used = [...counts].filter(([, n]) => n > 0);
    // "Added 5 items to Costco and 2 to Trader Joe's"
    const added = used
      .map(([id, n], i) => `${i === 0 ? plural(n) : n} to ${state.lists[id].name}`)
      .reduce((acc, part, i, all) => (i === 0 ? part : `${acc}${i === all.length - 1 ? " and " : ", "}${part}`), "");
    const addedMsg = added && `Added ${added}`;
    onClose();

    // The recipe is tagged with every list that got some of its ingredients, so everyone there can find it.
    const tagLists = used.map(([id]) => id);
    if (readding) {
      (async () => {
        for (const id of tagLists) {
          const r = await tagRecipe(recipeId!, id);
          onTagged?.(r);
        }
      })().catch(() => {});
      if (addedMsg) showToast(`${addedMsg}.`);
    } else if (willSave) {
      const home = tagLists.includes(target) || !tagLists.length ? target : tagLists[0];
      saveRecipe(recipe.draft!, home)
        .then(async ({ id, existing }) => {
          for (const l of tagLists) if (l !== home) await tagRecipe(id, l).catch(() => {});
          const saved = existing ? `“${recipe.name}” was already in Recipes` : `Saved “${recipe.name}” to Recipes`;
          showToast(addedMsg ? `${addedMsg}. ${saved}.` : `${saved}.`, { label: "View", run: () => navigate({ name: "recipe", id }) });
        })
        .catch(() => showToast(`${addedMsg ? `${addedMsg}, but the` : "The"} recipe couldn't be saved. Check your connection.`));
    } else if (addedMsg) showToast(`${addedMsg}.`);
  };

  const canFetch =
    !!target &&
    !preparing &&
    (mode === "url" ? /^https?:\/\/\S+\.\S+/i.test(url.trim()) : mode === "text" ? text.trim().length > 2 : photos.length > 0);
  const modes = canReadPhotos() ? (["url", "text", "photo"] as const) : (["url", "text"] as const);

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
                {modes.map((m) => (
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
                    {m === "url" ? <Link2 className="size-4" /> : m === "text" ? <TextCursorInput className="size-4" /> : <Camera className="size-4" />}
                    {m === "url" ? "Link" : m === "text" ? "Paste" : "Photo"}
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
              ) : mode === "photo" ? (
                <div className="grid grid-cols-2 gap-2">
                  {photos.map((p, i) => (
                    <div key={p.preview} className="relative aspect-[3/4] overflow-hidden rounded-xl bg-muted">
                      <img src={p.preview} alt={`Page ${i + 1}`} className="size-full object-cover" />
                      <span className="absolute bottom-1.5 left-1.5 rounded-full bg-black/60 px-2 py-0.5 text-xs font-medium text-white">
                        {photos.length > 1 ? `Page ${i + 1}` : "Photo"}
                      </span>
                      <button
                        aria-label={`Remove page ${i + 1}`}
                        disabled={loading}
                        onClick={() => {
                          URL.revokeObjectURL(p.preview);
                          setPhotos((ps) => ps.filter((x) => x !== p));
                        }}
                        className="absolute top-1.5 right-1.5 rounded-full bg-black/60 p-1 text-white"
                      >
                        <X className="size-4" />
                      </button>
                    </div>
                  ))}
                  {photos.length < MAX_PHOTOS && (
                    <PhotoButtons
                      first={photos.length === 0}
                      busy={loading || preparing}
                      preparing={preparing}
                      color={color}
                      onFiles={(f) => void addPhotos(f)}
                    />
                  )}
                </div>
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
                {loading ? (mode === "photo" ? "Reading the photo… (10–20 seconds)" : "Reading the recipe…") : mode === "photo" ? "Read Recipe" : "Get Ingredients"}
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                {mode === "url"
                  ? "Works with many recipe sites. Some big ones refuse automatic readers; for those, copy the recipe and paste it."
                  : mode === "text"
                    ? "Paste a whole recipe (title, ingredients and steps) to save it, or just the ingredients."
                    : "A cookbook page, a clipping or a handwritten card. If the recipe runs onto another page, add a photo of each. Only the text is kept, not the photos."}
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
                {!readding && <span>{destText}</span>}
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
                  ? `Already in Recipes. Saving tags it with ${destText} too.`
                  : `${recipe.draft.steps.length ? `With its ${recipe.draft.steps.filter((s) => !s.heading).length} steps. ` : ""}Everyone on ${destText} can find it and cook from it.`}
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
                      ? { backgroundColor: rowColor(r), borderColor: rowColor(r), color: "white" }
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
                    {multiList && (
                      <select
                        aria-label={`List for ${r.title}`}
                        value={r.listId}
                        onChange={(e) => moveTo(r, e.target.value)}
                        className="rounded bg-muted px-1.5 py-0.5 font-medium outline-none"
                        style={{ color: rowColor(r) }}
                      >
                        {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                      </select>
                    )}
                    <select
                      aria-label={`Section for ${r.title}`}
                      value={r.section}
                      onChange={(e) => update(r.key, { section: e.target.value })}
                      className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground outline-none"
                    >
                      {(state.lists[r.listId]?.sections ?? sections).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                    {isOnList(r) && <span className="rounded bg-muted px-1.5 py-0.5" style={{ color: rowColor(r) }}>Already on list</span>}
                    {r.staple && !isOnList(r) && <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">Pantry staple</span>}
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

/**
 * Two ways in: the camera straight away, or photos already taken. `capture` makes iPhones open the camera
 * instead of asking where the photo should come from.
 */
export function PhotoButtons({
  first,
  busy,
  preparing,
  color,
  onFiles,
  nextLabel = "Next page",
}: {
  nextLabel?: string;
  first: boolean;
  busy: boolean;
  preparing: boolean;
  color: string;
  onFiles: (files: FileList | null) => void;
}) {
  const input = (camera: boolean) => (
    <input
      type="file"
      accept="image/*"
      {...(camera ? { capture: "environment" as const } : { multiple: true })}
      className="sr-only"
      onChange={(e) => {
        onFiles(e.target.files);
        e.target.value = "";
      }}
    />
  );
  const tile = "flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed text-center text-sm font-medium";
  if (preparing) {
    return (
      <div className={cn(tile, first ? "col-span-2 py-10" : "aspect-[3/4]")} style={{ color }}>
        <Loader2 className="size-7 animate-spin" />
      </div>
    );
  }
  return (
    <div className={cn("grid gap-2", first ? "col-span-2 grid-cols-2" : "aspect-[3/4] grid-rows-2", busy && "pointer-events-none opacity-50")}>
      <label className={cn(tile, first && "py-8")} style={{ color }}>
        <Camera className={first ? "size-8" : "size-6"} />
        {first ? "Take Photo" : nextLabel}
        {input(true)}
      </label>
      <label className={cn(tile, first && "py-8")} style={{ color }}>
        <Images className={first ? "size-8" : "size-6"} />
        {first ? "Choose Photos" : "Choose"}
        {input(false)}
      </label>
    </div>
  );
}
