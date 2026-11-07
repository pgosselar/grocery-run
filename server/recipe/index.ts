import type { Request, Response } from "express";
import type { ParsedIngredient, RecipeImport } from "../../shared/types.ts";
import { fetchPage, FetchError } from "./fetch.ts";
import { extractRecipe, stripTags } from "./extract.ts";
import { parseIngredientsWithRules } from "./ingredients.ts";
import { claudeEnabled, cleanWithClaude } from "./claude.ts";

const MAX_LINES = 80;

/** POST /api/recipe { url } or { text } → cleaned ingredients for the preview screen. */
export async function importRecipe(req: Request, res: Response) {
  const { url, text } = (req.body ?? {}) as { url?: unknown; text?: unknown };
  let name = "Recipe";
  let lines: string[] = [];
  let image: string | null = null;
  let servings: string | null = null;
  let finalUrl: string | null = null;

  try {
    if (typeof url === "string" && url.trim()) {
      const page = await fetchPage(url);
      finalUrl = page.finalUrl;
      const recipe = extractRecipe(page.html);
      if (!recipe) {
        return res.status(422).json({
          error: "Couldn't find a recipe on that page. Paste the ingredients instead.",
        });
      }
      ({ name, image, servings } = recipe);
      lines = recipe.ingredients;
    } else if (typeof text === "string" && text.trim()) {
      lines = text.split(/\r?\n/).map(stripTags).filter(Boolean);
      name = "Pasted recipe";
    } else {
      return res.status(400).json({ error: "Give a recipe link or paste some ingredients." });
    }
  } catch (err) {
    if (err instanceof FetchError) return res.status(422).json({ error: err.message });
    console.error("recipe fetch failed", err);
    return res.status(500).json({ error: "Something went wrong reading that page." });
  }

  lines = lines.slice(0, MAX_LINES);
  let ingredients: ParsedIngredient[];
  let cleanedBy: RecipeImport["cleanedBy"] = "rules";
  let warning: string | undefined;

  if (claudeEnabled) {
    try {
      ingredients = await cleanWithClaude(name, lines);
      cleanedBy = "claude";
    } catch (err) {
      console.error("Claude cleanup failed, using rules:", err instanceof Error ? err.message : err);
      ingredients = parseIngredientsWithRules(lines);
      warning = "Smart cleanup wasn't available, so these were tidied with basic rules. Double-check them.";
    }
  } else {
    ingredients = parseIngredientsWithRules(lines);
  }

  const body: RecipeImport = { name, url: finalUrl, image, servings, ingredients, cleanedBy, warning };
  res.json(body);
}
