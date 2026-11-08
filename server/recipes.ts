// The recipe box: recipes saved from imports, visible to whoever saved them and to everyone on a list
// they're tagged with. Searchable by title, ingredients and steps.
import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import type {
  ListSection, ParsedIngredient, Recipe, RecipeDraft, RecipeImport, RecipeLine, RecipeSummary, ShoppingItem,
} from "../shared/types.ts";
import { categorize, defaultSections } from "../shared/sections.ts";
import { db, listById, roleOf, tx } from "./db.ts";
import { currentUser } from "./auth.ts";
import { claudeEnabled, cleanWithClaude } from "./recipe/claude.ts";
import { parseIngredientsWithRules } from "./recipe/ingredients.ts";

const MAX_BYTES = 200_000;
const MAX_LINES = 200;
const MAX_LINE = 2000;

// ---------- validation ----------

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const strOrNull = (v: unknown, max: number) => str(v, max) || null;
const httpUrl = (v: unknown) => {
  const s = str(v, 2000);
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
};

function lines(v: unknown): RecipeLine[] {
  if (!Array.isArray(v)) return [];
  return v
    .slice(0, MAX_LINES)
    .map((l) => ({ text: str((l as RecipeLine)?.text, MAX_LINE), heading: (l as RecipeLine)?.heading === true }))
    .filter((l) => l.text)
    .map((l) => (l.heading ? l : { text: l.text }));
}

function shopping(v: unknown): ShoppingItem[] | null {
  if (!Array.isArray(v)) return null;
  return v.slice(0, MAX_LINES).flatMap((x) => {
    const i = x as ShoppingItem;
    const title = str(i?.title, 200);
    if (!title) return [];
    const hint = str(i.sectionHint, 100);
    return [{
      original: str(i.original, MAX_LINE),
      title,
      quantity: str(i.quantity, 100),
      notes: str(i.notes, 500),
      staple: i.staple === true,
      ...(hint ? { sectionHint: hint } : {}),
    }];
  });
}

/** Keep only the fields we know, trimmed and capped. Returns null when there's nothing worth saving. */
export function cleanDraft(raw: unknown): RecipeDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Partial<RecipeDraft>;
  const times = (d.times && typeof d.times === "object" ? d.times : {}) as RecipeDraft["times"];
  const draft: RecipeDraft = {
    title: str(d.title, 200) || "Untitled recipe",
    url: httpUrl(d.url),
    siteName: strOrNull(d.siteName, 100),
    author: strOrNull(d.author, 100),
    image: httpUrl(d.image),
    description: str(d.description, 2000),
    servings: strOrNull(d.servings, 60),
    times: Object.fromEntries(
      (["prep", "cook", "total"] as const).flatMap((k) => (str(times[k], 40) ? [[k, str(times[k], 40)]] : [])),
    ),
    ingredients: lines(d.ingredients),
    steps: lines(d.steps),
    notes: str(d.notes, 10_000),
    shopping: shopping(d.shopping),
  };
  if (!draft.ingredients.length && !draft.steps.length) return null;
  if (JSON.stringify(draft).length > MAX_BYTES) return null;
  return draft;
}

// ---------- storage ----------

const insertRecipe = db.prepare(
  "INSERT INTO recipes(id, data, url, created_by, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?)",
);
const updateRecipe = db.prepare("UPDATE recipes SET data = ?, url = ?, updated_at = ? WHERE id = ?");
const deleteRecipeRow = db.prepare("DELETE FROM recipes WHERE id = ?");
const getRecipeRow = db.prepare(`
  SELECT r.*, u.name AS creator FROM recipes r LEFT JOIN users u ON u.id = r.created_by WHERE r.id = ?
`);
const tagStmt = db.prepare(`
  INSERT INTO recipe_lists(recipe_id, list_id, added_by, added_at) VALUES(?, ?, ?, ?)
  ON CONFLICT(recipe_id, list_id) DO NOTHING
`);
const untagStmt = db.prepare("DELETE FROM recipe_lists WHERE recipe_id = ? AND list_id = ?");
const ftsDelete = db.prepare("DELETE FROM recipes_fts WHERE id = ?");
const ftsInsert = db.prepare("INSERT INTO recipes_fts(id, title, ingredients, body) VALUES(?, ?, ?, ?)");
const ftsSearch = db.prepare("SELECT id FROM recipes_fts WHERE recipes_fts MATCH ? ORDER BY rank LIMIT 500");

/** Recipes this person can see: their own, plus any tagged with a list they're on. */
const VISIBLE = `
  (r.created_by = ? OR EXISTS (
    SELECT 1 FROM recipe_lists rl JOIN members m ON m.list_id = rl.list_id
    WHERE rl.recipe_id = r.id AND m.user_id = ?))
`;
const canSeeStmt = db.prepare(`SELECT 1 FROM recipes r WHERE r.id = ? AND ${VISIBLE}`);
const visibleRows = db.prepare(`SELECT r.id, r.data, r.updated_at FROM recipes r WHERE ${VISIBLE} ORDER BY r.updated_at DESC`);
const visibleByUrl = db.prepare(`SELECT r.id FROM recipes r WHERE r.url = ? AND ${VISIBLE} ORDER BY r.created_at LIMIT 1`);
/** Tags limited to lists this person is on: other people's list names aren't theirs to see. */
const myTags = db.prepare(`
  SELECT rl.recipe_id, rl.list_id FROM recipe_lists rl
  JOIN members m ON m.list_id = rl.list_id AND m.user_id = ?
  ORDER BY rl.added_at
`);
const myTagsFor = db.prepare(`
  SELECT rl.list_id FROM recipe_lists rl JOIN members m ON m.list_id = rl.list_id AND m.user_id = ?
  WHERE rl.recipe_id = ? ORDER BY rl.added_at
`);

const canSee = (id: string, userId: string) => !!canSeeStmt.get(id, userId, userId);

function index(id: string, d: RecipeDraft) {
  ftsDelete.run(id);
  ftsInsert.run(
    id,
    d.title,
    d.ingredients.map((l) => l.text).join("\n"),
    [d.description, d.siteName ?? "", d.author ?? "", ...d.steps.map((l) => l.text), d.notes].join("\n"),
  );
}

function recipeFor(id: string, userId: string): Recipe | null {
  if (!canSee(id, userId)) return null;
  const row = getRecipeRow.get(id) as
    | { id: string; data: string; created_by: string; creator: string | null; created_at: number; updated_at: number }
    | undefined;
  if (!row) return null;
  return {
    ...(JSON.parse(row.data) as RecipeDraft),
    id: row.id,
    createdById: row.created_by,
    createdBy: row.creator ?? "Someone",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lists: (myTagsFor.all(userId, id) as { list_id: string }[]).map((r) => r.list_id),
    mine: row.created_by === userId,
  };
}

function draftOf(id: string): RecipeDraft {
  return JSON.parse((getRecipeRow.get(id) as { data: string }).data) as RecipeDraft;
}

function save(id: string, d: RecipeDraft) {
  updateRecipe.run(JSON.stringify(d), d.url, Date.now(), id);
  index(id, d);
}

/** FTS query from what someone typed: every word must match, as a prefix ("chick" finds chickpeas). */
function ftsQuery(q: string): string | null {
  const words = q.toLowerCase().match(/[\p{L}\p{N}]+/gu)?.slice(0, 8) ?? [];
  return words.length ? words.map((w) => `"${w}"*`).join(" ") : null;
}

export function searchRecipes(userId: string, q: string, listId: string | null): RecipeSummary[] {
  const tags = new Map<string, string[]>();
  for (const t of myTags.all(userId) as { recipe_id: string; list_id: string }[]) {
    tags.set(t.recipe_id, [...(tags.get(t.recipe_id) ?? []), t.list_id]);
  }
  let rows = visibleRows.all(userId, userId) as { id: string; data: string; updated_at: number }[];
  const fq = q.trim() ? ftsQuery(q) : null;
  if (fq) {
    const rank = new Map((ftsSearch.all(fq) as { id: string }[]).map((r, i) => [r.id, i]));
    rows = rows.filter((r) => rank.has(r.id)).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  } else if (q.trim()) {
    rows = [];
  }
  if (listId) rows = rows.filter((r) => tags.get(r.id)?.includes(listId));
  return rows.slice(0, 300).map((r) => {
    const d = JSON.parse(r.data) as RecipeDraft;
    return {
      id: r.id,
      title: d.title,
      image: d.image,
      siteName: d.siteName,
      totalTime: d.times.total ?? null,
      lists: tags.get(r.id) ?? [],
      updatedAt: r.updated_at,
    };
  });
}

/** A recipe from this link that this person can already see, so importing it again doesn't make a copy. */
export function existingRecipeFor(url: string | null, userId: string): string | null {
  if (!url) return null;
  return (visibleByUrl.get(url, userId, userId) as { id: string } | undefined)?.id ?? null;
}

// ---------- shopping items for a list ----------

function learnedSection(title: string, sections: ListSection[]): string | null {
  const t = title.toLowerCase().trim();
  return sections.find((s) => s.keywords.some((k) => k.trim() === t))?.id ?? null;
}

/** Sort saved shopping items into one list's sections: learned words, then a same-named section, then keywords. */
export function sortForList(items: ShoppingItem[], sections: ListSection[]): ParsedIngredient[] {
  const byName = new Map(sections.map((s) => [s.name.toLowerCase(), s.id]));
  return items.map(({ sectionHint, ...i }) => ({
    ...i,
    section:
      learnedSection(i.title, sections) ??
      (sectionHint ? byName.get(sectionHint.toLowerCase()) : undefined) ??
      categorize(i.title, sections),
  }));
}

/** Shopping items as saved with a recipe: what the preview showed, minus the per-list section. */
export function toShopping(items: ParsedIngredient[], sections: ListSection[]): ShoppingItem[] {
  const names = new Map(sections.map((s) => [s.id, s.name]));
  return items.map(({ section, ...i }) => ({ ...i, sectionHint: names.get(section) }));
}

// ---------- HTTP ----------

const notFound = (res: Response) => res.status(404).json({ error: "That recipe isn't in your recipe box." });

export function listRecipes(req: Request, res: Response) {
  const user = currentUser(res);
  const q = typeof req.query.q === "string" ? req.query.q.slice(0, 200) : "";
  const listId = typeof req.query.list === "string" && req.query.list ? req.query.list : null;
  if (listId && !roleOf(listId, user.id)) return res.status(404).json({ error: "No such list" });
  res.json(searchRecipes(user.id, q, listId));
}

export function getRecipe(req: Request, res: Response) {
  const r = recipeFor(String(req.params.id), currentUser(res).id);
  return r ? res.json(r) : notFound(res);
}

/** Save an imported recipe and tag it with the list it was imported into. Same link again → just tag it. */
export function createRecipe(req: Request, res: Response) {
  const user = currentUser(res);
  const { draft: raw, listId } = (req.body ?? {}) as { draft?: unknown; listId?: unknown };
  if (typeof listId !== "string" || !roleOf(listId, user.id)) return res.status(404).json({ error: "No such list" });
  const draft = cleanDraft(raw);
  if (!draft) return res.status(400).json({ error: "There's no recipe to save." });
  const now = Date.now();
  const existing = existingRecipeFor(draft.url, user.id);
  const id = existing ?? randomUUID();
  tx(() => {
    if (!existing) {
      insertRecipe.run(id, JSON.stringify(draft), draft.url, user.id, now, now);
      index(id, draft);
    }
    tagStmt.run(id, listId, user.id, now);
  });
  res.json({ id, existing: !!existing });
}

/** Edit what people see. Changing the ingredients drops the saved shopping items so they're rebuilt. */
export function editRecipe(req: Request, res: Response) {
  const user = currentUser(res);
  const id = String(req.params.id);
  if (!canSee(id, user.id)) return notFound(res);
  const before = draftOf(id);
  const patch = (req.body ?? {}) as Partial<RecipeDraft>;
  const merged = cleanDraft({ ...before, ...patch, url: before.url, shopping: before.shopping });
  if (!merged) return res.status(400).json({ error: "A recipe needs some ingredients or steps." });
  if (JSON.stringify(merged.ingredients) !== JSON.stringify(before.ingredients)) merged.shopping = null;
  save(id, merged);
  res.json(recipeFor(id, user.id));
}

export function deleteRecipe(req: Request, res: Response) {
  const user = currentUser(res);
  const r = recipeFor(String(req.params.id), user.id);
  if (!r) return notFound(res);
  if (!r.mine) return res.status(403).json({ error: `Only ${r.createdBy} can delete this recipe. You can remove it from your lists.` });
  tx(() => {
    deleteRecipeRow.run(r.id);
    ftsDelete.run(r.id);
  });
  res.json({ ok: true });
}

export function tagRecipe(req: Request, res: Response) {
  const user = currentUser(res);
  const id = String(req.params.id);
  const listId = String((req.body ?? {}).listId ?? "");
  if (!canSee(id, user.id)) return notFound(res);
  if (!roleOf(listId, user.id)) return res.status(404).json({ error: "No such list" });
  tagStmt.run(id, listId, user.id, Date.now());
  res.json(recipeFor(id, user.id));
}

export function untagRecipe(req: Request, res: Response) {
  const user = currentUser(res);
  const id = String(req.params.id);
  const listId = String(req.params.listId);
  if (!canSee(id, user.id) || !roleOf(listId, user.id)) return notFound(res);
  untagStmt.run(id, listId);
  // Untagging the last list someone shares with it can take it out of their sight entirely.
  res.json({ recipe: recipeFor(id, user.id) });
}

/** The ingredients as shopping items sorted for one list, ready for the "Add Ingredients" preview. */
export async function recipeShopping(req: Request, res: Response) {
  const user = currentUser(res);
  const id = String(req.params.id);
  const listId = String((req.body ?? {}).listId ?? "");
  if (!canSee(id, user.id)) return notFound(res);
  const list = roleOf(listId, user.id) ? listById(listId) : null;
  if (!list) return res.status(404).json({ error: "No such list" });
  const sections = list.sections?.length ? list.sections : defaultSections();
  const d = draftOf(id);
  let cleanedBy: RecipeImport["cleanedBy"] = "rules";
  let warning: string | undefined;
  let ingredients: ParsedIngredient[];

  if (d.shopping) {
    ingredients = sortForList(d.shopping, sections);
  } else {
    // Edited since it was saved (or saved without a cleanup): tidy the ingredient lines again, once.
    const lines = d.ingredients.filter((l) => !l.heading).map((l) => l.text);
    try {
      if (!claudeEnabled) throw new Error("off");
      ingredients = await cleanWithClaude(d.title, lines, list.name, sections);
      cleanedBy = "claude";
    } catch (err) {
      if (claudeEnabled) {
        console.error("Claude cleanup failed, using rules:", err instanceof Error ? err.message : err);
        warning = "Smart cleanup wasn't available, so these were tidied with basic rules. Double-check them.";
      }
      ingredients = parseIngredientsWithRules(lines, sections);
    }
    save(id, { ...draftOf(id), shopping: toShopping(ingredients, sections) });
  }

  const body: RecipeImport = { name: d.title, url: d.url, image: d.image, servings: d.servings, ingredients, cleanedBy, warning };
  res.json(body);
}
