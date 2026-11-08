// The recipe box on the client. Recipes live on the server (they can be big, and search runs there);
// the ones opened on this phone are kept so they can still be read, and cooked from, offline.
import type { Recipe, RecipeDraft, RecipeImport, RecipeSummary } from "../../shared/types";
import { RECIPE_CACHE_KEY, api } from "./store";
import { safeStorage, saveStorage } from "./utils";

const KEEP = 40;

interface Cache {
  summaries: RecipeSummary[];
  full: Record<string, Recipe>;
  /** Most recently opened first */
  order: string[];
}

const emptyCache = (): Cache => ({ summaries: [], full: {}, order: [] });
const load = (): Cache => safeStorage<Cache | null>(RECIPE_CACHE_KEY, null) ?? emptyCache();

function remember(r: Recipe) {
  const c = load();
  c.full[r.id] = r;
  c.order = [r.id, ...c.order.filter((id) => id !== r.id)];
  for (const id of c.order.slice(KEEP)) delete c.full[id];
  c.order = c.order.slice(0, KEEP);
  c.summaries = c.summaries.map((s) => (s.id === r.id ? summaryOf(r) : s));
  saveStorage(RECIPE_CACHE_KEY, c);
}

function forget(id: string) {
  const c = load();
  delete c.full[id];
  c.order = c.order.filter((x) => x !== id);
  c.summaries = c.summaries.filter((s) => s.id !== id);
  saveStorage(RECIPE_CACHE_KEY, c);
}

const summaryOf = (r: Recipe): RecipeSummary => ({
  id: r.id,
  title: r.title,
  image: r.image,
  siteName: r.siteName,
  totalTime: r.times.total ?? null,
  lists: r.lists,
  updatedAt: r.updatedAt,
});

const offline = (e: unknown) => e instanceof Error && /reach the server/.test(e.message);

/** Search the recipe box. Offline, falls back to matching titles in what this phone last saw. */
export async function searchRecipes(q: string, listId?: string): Promise<{ recipes: RecipeSummary[]; offline: boolean }> {
  const params = new URLSearchParams();
  if (q.trim()) params.set("q", q.trim());
  if (listId) params.set("list", listId);
  try {
    const recipes = await api<RecipeSummary[]>("GET", `/api/recipes?${params}`);
    if (!q.trim() && !listId) saveStorage(RECIPE_CACHE_KEY, { ...load(), summaries: recipes });
    return { recipes, offline: false };
  } catch (e) {
    if (!offline(e)) throw e;
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const recipes = load().summaries.filter(
      (s) => (!listId || s.lists.includes(listId)) && words.every((w) => s.title.toLowerCase().includes(w)),
    );
    return { recipes, offline: true };
  }
}

/** A recipe in full; the copy on this phone right away if there is one, then the server's. */
export function cachedRecipe(id: string): Recipe | null {
  return load().full[id] ?? null;
}

export async function getRecipe(id: string): Promise<Recipe> {
  try {
    const r = await api<Recipe>("GET", `/api/recipes/${id}`);
    remember(r);
    return r;
  } catch (e) {
    const cached = cachedRecipe(id);
    if (offline(e) && cached) return cached;
    if (!offline(e)) forget(id);
    throw e;
  }
}

export async function saveRecipe(draft: RecipeDraft, listId: string) {
  return api<{ id: string; existing: boolean }>("POST", "/api/recipes", { draft, listId });
}

export async function editRecipe(id: string, patch: Partial<RecipeDraft>) {
  const r = await api<Recipe>("PATCH", `/api/recipes/${id}`, patch);
  remember(r);
  return r;
}

export async function deleteRecipe(id: string) {
  await api("DELETE", `/api/recipes/${id}`);
  forget(id);
}

export async function tagRecipe(id: string, listId: string) {
  const r = await api<Recipe>("POST", `/api/recipes/${id}/lists`, { listId });
  remember(r);
  return r;
}

/** Returns null when removing the tag took the recipe out of this person's sight. */
export async function untagRecipe(id: string, listId: string): Promise<Recipe | null> {
  const { recipe } = await api<{ recipe: Recipe | null }>("DELETE", `/api/recipes/${id}/lists/${listId}`);
  if (recipe) remember(recipe);
  else forget(id);
  return recipe;
}

export function recipeShopping(id: string, listId: string) {
  return api<RecipeImport>("POST", `/api/recipes/${id}/shopping`, { listId });
}
