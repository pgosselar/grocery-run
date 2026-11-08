// Smart cleanup with Claude: handles the messy lines the rules stumble on
// ("1 (14 oz) can fire-roasted tomatoes with green chiles, undrained"), merges
// duplicates and picks store sections. Only used when ANTHROPIC_API_KEY is set.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { ListSection, ParsedIngredient } from "../../shared/types.ts";
import { categorize } from "../../shared/sections.ts";

export const claudeEnabled = Boolean(process.env.ANTHROPIC_API_KEY);

const MODEL = process.env.RECIPE_MODEL || "claude-opus-5-5";

const client = claudeEnabled ? new Anthropic({ timeout: 60_000, maxRetries: 1 }) : null;

/** The answer's shape; `section` must be one of this list's own section names. */
function cleanedSchema(sectionNames: [string, ...string[]]) {
  return z.object({ items: itemsSchema(sectionNames) });
}

/** For a pasted recipe: also say which lines are the title, ingredients, steps and headings. */
function pastedSchema(sectionNames: [string, ...string[]]) {
  const lineNumbers = (what: string) => z.array(z.number().int()).describe(`1-based numbers of the lines that are ${what}, in order`);
  return z.object({
    title: z.string().describe("The recipe's name if the text includes one, else ''"),
    servings: z.string().describe("How many it serves or makes, if stated (e.g. '4', '24 cookies'), else ''"),
    ingredientLines: lineNumbers("ingredients, or headings that group ingredients"),
    stepLines: lineNumbers("instructions, or headings that group instructions"),
    noteLines: lineNumbers("notes or tips that are neither ingredients nor steps"),
    headingLines: lineNumbers("group headings such as 'For the sauce' or 'Assembly'"),
    items: itemsSchema(sectionNames),
  });
}

function itemsSchema(sectionNames: [string, ...string[]]) {
  return z.array(
      z.object({
        sources: z.array(z.number().int()).describe("1-based numbers of the recipe lines this item comes from"),
        title: z.string().describe("What to look for at the store, e.g. 'Diced tomatoes', 'Chicken thighs'"),
        quantity: z.string().describe("Amount as written in the recipe, e.g. '2 1/2 cups', '1 can (14 oz)'; '' if none"),
        notes: z.string().describe("Useful shopping detail (size, variety, 'boneless skinless'); '' if none"),
        section: z.enum(sectionNames),
        staple: z.boolean().describe("True for things nearly every kitchen already has"),
      }),
    );
}

const SYSTEM = `You turn recipe ingredient lines into a family grocery list.

For each real ingredient, produce one shopping item:
- title: the product a shopper looks for, in plain words with a capital first letter. Drop prep steps (chopped, minced, softened, room temperature) — those don't affect what you buy. Keep descriptors that do (diced vs whole tomatoes, unsalted butter, boneless skinless, low-sodium).
- quantity: the amount from the recipe in compact form ("2 1/2 cups", "3 cloves", "1 can (14 oz)"). Leave empty if the recipe gives none ("salt to taste").
- notes: only details that help at the store ("or margarine", "about 2 limes"). Leave empty otherwise.
- section: the section of this store's list where a shopper would find it. Use the family's own section names exactly; the hints show what they usually put in each. Canned and jarred goods, dried spices and baking supplies usually go in a pantry-type section.
- staple: true only for salt, pepper, water, ice, cooking oils and cooking spray.

If the same product appears more than once (butter for the crust and the filling), output it once, list every source line, and combine the quantities ("4 tbsp + 1/2 cup").
Skip lines that aren't ingredients, such as section headings ("For the sauce:") or equipment.`;

function sectionContext(sections: ListSection[]) {
  // Section names can repeat after renames; the schema needs them unique.
  const names = [...new Set(sections.map((s) => s.name))] as [string, ...string[]];
  const idByName = new Map(sections.map((s) => [s.name, s.id]));
  const guide = sections
    .map((s) => `- ${s.name}${s.keywords.length ? `: e.g. ${s.keywords.slice(0, 12).map((k) => k.trim()).join(", ")}` : ""}`)
    .join("\n");
  return { names, idByName, guide };
}

async function ask<T extends z.ZodType>(schema: T, system: string, content: string): Promise<z.infer<T>> {
  if (!client) throw new Error("Claude is not configured");
  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    // Simple extraction: low effort keeps it quick for someone standing in the kitchen.
    output_config: { effort: "low", format: betaZodOutputFormat(schema) },
    // If a safety classifier declines, retry server-side on Anthropic's recommended model.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system,
    messages: [{ role: "user", content }],
  });
  if (response.stop_reason === "refusal") throw new Error("Claude declined to process this recipe");
  if (response.stop_reason === "max_tokens") throw new Error("Claude's answer was cut off");
  if (!response.parsed_output) throw new Error("Claude returned nothing usable");
  return response.parsed_output as z.infer<T>;
}

type RawItem = z.infer<ReturnType<typeof itemsSchema>>[number];

function toIngredients(items: RawItem[], lines: string[], sections: ListSection[], idByName: Map<string, string>): ParsedIngredient[] {
  return items
    .filter((it) => it.title.trim())
    .map((it) => ({
      original: it.sources
        .map((n) => lines[n - 1])
        .filter(Boolean)
        .join("\n"),
      title: it.title.trim(),
      quantity: it.quantity.trim(),
      notes: it.notes.trim(),
      // A word this family taught the list beats Claude's guess: they know their store.
      section: learnedSection(it.title, sections) ?? idByName.get(it.section) ?? categorize(it.title, sections),
      staple: it.staple,
    }));
}

export async function cleanWithClaude(
  recipeName: string,
  lines: string[],
  listName: string,
  sections: ListSection[],
): Promise<ParsedIngredient[]> {
  const { names, idByName, guide } = sectionContext(sections);
  const numbered = lines.map((l, i) => `${i + 1}. ${l}`).join("\n");
  const parsed = await ask(
    cleanedSchema(names),
    SYSTEM,
    `Store list: ${listName}\nSections, in store order:\n${guide}\n\nRecipe: ${recipeName}\n\nIngredient lines:\n${numbered}`,
  );
  if (!parsed.items.length) throw new Error("Claude returned no items");
  return toIngredients(parsed.items, lines, sections, idByName);
}

const PASTED_SYSTEM = `${SYSTEM}

This time the text was pasted by hand and may be a whole recipe: a title, a blurb, ingredients, steps and notes, in any order and with or without headings. First say which numbered lines are which (leave out lines that are none of these, like ads, ratings or "Print recipe", and leave out the words "Ingredients" or "Directions" when they're just labels). Then produce shopping items from the ingredient lines only.`;

export interface PastedLayout {
  title: string;
  servings: string;
  ingredientLines: number[];
  stepLines: number[];
  noteLines: number[];
  headingLines: number[];
}

/** Read a hand-pasted recipe: which lines are what, plus the shopping items. One call, small output. */
export async function readPastedWithClaude(
  lines: string[],
  listName: string,
  sections: ListSection[],
): Promise<{ layout: PastedLayout; ingredients: ParsedIngredient[] }> {
  const { names, idByName, guide } = sectionContext(sections);
  const numbered = lines.map((l, i) => `${i + 1}. ${l}`).join("\n");
  const parsed = await ask(
    pastedSchema(names),
    PASTED_SYSTEM,
    `Store list: ${listName}\nSections, in store order:\n${guide}\n\nPasted text, one numbered line each:\n${numbered}`,
  );
  const { items, ...layout } = parsed;
  return { layout, ingredients: toIngredients(items, lines, sections, idByName) };
}

/** Section from a keyword someone added by hand or by moving an item, if one matches exactly. */
function learnedSection(title: string, sections: ListSection[]): string | null {
  const t = title.toLowerCase().trim();
  return sections.find((s) => s.keywords.some((k) => k.trim() === t))?.id ?? null;
}
