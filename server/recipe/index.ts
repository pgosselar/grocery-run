import type { Request, Response } from "express";
import type { ParsedIngredient, RecipeDraft, RecipeImport, RecipeLine } from "../../shared/types.ts";
import { defaultSections } from "../../shared/sections.ts";
import { normalizeTime } from "../../shared/time.ts";
import { listById, roleOf } from "../db.ts";
import { currentUser } from "../auth.ts";
import { existingRecipeFor, toShopping } from "../recipes.ts";
import { fetchPage, FetchError } from "./fetch.ts";
import { extractRecipe, stripTags } from "./extract.ts";
import { parseIngredientsWithRules } from "./ingredients.ts";
import { claudeEnabled, cleanWithClaude, readPastedWithClaude } from "./claude.ts";
import { isHeading, splitPastedRecipe } from "./split.ts";

const MAX_LINES = 80;
const MAX_PASTED_LINES = 250;

const SMART_FAILED = "Smart cleanup wasn't available, so these were tidied with basic rules. Double-check them.";

/**
 * POST /api/recipe { listId, url } or { listId, text } → cleaned ingredients for the preview screen, plus
 * the whole recipe (steps and all) so it can be saved to the recipe box.
 */
export async function importRecipe(req: Request, res: Response) {
  const { url, text, listId } = (req.body ?? {}) as { url?: unknown; text?: unknown; listId?: unknown };
  const user = currentUser(res);
  const list = typeof listId === "string" && roleOf(listId, user.id) ? listById(listId) : null;
  if (!list) return res.status(404).json({ error: "No such list" });
  const sections = list.sections?.length ? list.sections : defaultSections();

  let draft: RecipeDraft = {
    title: "Pasted recipe", url: null, siteName: null, author: null, image: null, description: "", servings: null,
    times: {}, ingredients: [], steps: [], notes: "", shopping: null,
  };
  let ingredients: ParsedIngredient[] = [];
  let cleanedBy: RecipeImport["cleanedBy"] = "rules";
  let warning: string | undefined;

  try {
    if (typeof url === "string" && url.trim()) {
      const page = await fetchPage(url);
      const recipe = extractRecipe(page.html);
      if (!recipe) {
        return res.status(422).json({ error: "Couldn't find a recipe on that page. Paste it instead." });
      }
      draft = {
        ...draft,
        title: recipe.name,
        url: page.finalUrl,
        siteName: recipe.siteName ?? new URL(page.finalUrl).hostname.replace(/^www\./, ""),
        author: recipe.author,
        image: recipe.image,
        description: recipe.description,
        servings: recipe.servings,
        times: recipe.times,
        ingredients: recipe.ingredients.map((t): RecipeLine => (isHeading(t) ? { text: t.replace(/:$/, ""), heading: true } : { text: t })),
        steps: recipe.steps,
      };
      const lines = recipe.ingredients.slice(0, MAX_LINES);
      ({ ingredients, cleanedBy, warning } = await clean(draft.title, lines, list.name, sections));
    } else if (typeof text === "string" && text.trim()) {
      const lines = text.split(/\r?\n/).map(stripTags).filter(Boolean).slice(0, MAX_PASTED_LINES);
      ({ draft, ingredients, cleanedBy, warning } = await readPasted(draft, lines, list.name, sections));
    } else {
      return res.status(400).json({ error: "Give a recipe link or paste a recipe." });
    }
  } catch (err) {
    if (err instanceof FetchError) return res.status(422).json({ error: err.message });
    console.error("recipe import failed", err);
    return res.status(500).json({ error: "Something went wrong reading that recipe." });
  }

  draft.shopping = toShopping(ingredients, sections);
  const body: RecipeImport = {
    name: draft.title,
    url: draft.url,
    image: draft.image,
    servings: draft.servings,
    ingredients,
    cleanedBy,
    warning,
    draft,
    existingId: existingRecipeFor(draft.url, user.id),
  };
  res.json(body);
}

async function clean(name: string, lines: string[], listName: string, sections: Parameters<typeof cleanWithClaude>[3]) {
  if (claudeEnabled) {
    try {
      return { ingredients: await cleanWithClaude(name, lines, listName, sections), cleanedBy: "claude" as const, warning: undefined };
    } catch (err) {
      console.error("Claude cleanup failed, using rules:", err instanceof Error ? err.message : err);
      return { ingredients: parseIngredientsWithRules(lines, sections), cleanedBy: "rules" as const, warning: SMART_FAILED };
    }
  }
  return { ingredients: parseIngredientsWithRules(lines, sections), cleanedBy: "rules" as const, warning: undefined };
}

/** A pasted recipe: Claude reads the layout and the ingredients in one go; otherwise headings and rules. */
async function readPasted(base: RecipeDraft, lines: string[], listName: string, sections: Parameters<typeof cleanWithClaude>[3]) {
  if (claudeEnabled) {
    try {
      const { layout, ingredients } = await readPastedWithClaude(lines, listName, sections);
      const headings = new Set(layout.headingLines);
      const pick = (nums: number[]): RecipeLine[] =>
        nums
          .filter((n) => lines[n - 1])
          .map((n) => {
            const t = lines[n - 1].replace(/^(?:step\s*)?\d+\s*[.):-]\s*/i, "").trim();
            return headings.has(n) ? { text: t.replace(/:$/, ""), heading: true } : { text: t };
          });
      const draft: RecipeDraft = {
        ...base,
        title: layout.title.trim() || base.title,
        servings: layout.servings.trim() || null,
        times: Object.fromEntries(
          ([["prep", layout.prepTime], ["cook", layout.cookTime], ["total", layout.totalTime]] as const).flatMap(([k, v]) => {
            const t = normalizeTime(v);
            return t ? [[k, t]] : [];
          }),
        ),
        ingredients: pick(layout.ingredientLines),
        steps: pick(layout.stepLines),
        notes: layout.noteLines.map((n) => lines[n - 1]).filter(Boolean).join("\n"),
      };
      if (draft.ingredients.length || ingredients.length) return { draft, ingredients, cleanedBy: "claude" as const, warning: undefined };
    } catch (err) {
      console.error("Claude couldn't read the pasted recipe, using rules:", err instanceof Error ? err.message : err);
    }
  }
  const split = splitPastedRecipe(lines.join("\n"));
  const draft: RecipeDraft = {
    ...base,
    title: split.title ?? base.title,
    servings: split.servings,
    times: split.times,
    ingredients: split.ingredients,
    steps: split.steps,
    notes: split.notes,
  };
  const ingLines = split.ingredients.filter((l) => !l.heading).map((l) => l.text).slice(0, MAX_LINES);
  return {
    draft,
    ingredients: parseIngredientsWithRules(ingLines, sections),
    cleanedBy: "rules" as const,
    warning: claudeEnabled ? SMART_FAILED : undefined,
  };
}
