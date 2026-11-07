// Smart cleanup with Claude: handles the messy lines the rules stumble on
// ("1 (14 oz) can fire-roasted tomatoes with green chiles, undrained"), merges
// duplicates and picks store sections. Only used when ANTHROPIC_API_KEY is set.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { ParsedIngredient } from "../../shared/types.ts";
import { SECTIONS } from "../../shared/sections.ts";

export const claudeEnabled = Boolean(process.env.ANTHROPIC_API_KEY);

const MODEL = process.env.RECIPE_MODEL || "claude-opus-5-5";

const client = claudeEnabled ? new Anthropic({ timeout: 60_000, maxRetries: 1 }) : null;

const Cleaned = z.object({
  items: z.array(
    z.object({
      sources: z.array(z.number().int()).describe("1-based numbers of the recipe lines this item comes from"),
      title: z.string().describe("What to look for at the store, e.g. 'Diced tomatoes', 'Chicken thighs'"),
      quantity: z.string().describe("Amount as written in the recipe, e.g. '2 1/2 cups', '1 can (14 oz)'; '' if none"),
      notes: z.string().describe("Useful shopping detail (size, variety, 'boneless skinless'); '' if none"),
      section: z.enum(SECTIONS),
      staple: z.boolean().describe("True for things nearly every kitchen already has"),
    }),
  ),
});

const SYSTEM = `You turn recipe ingredient lines into a family grocery list.

For each real ingredient, produce one shopping item:
- title: the product a shopper looks for, in plain words with a capital first letter. Drop prep steps (chopped, minced, softened, room temperature) — those don't affect what you buy. Keep descriptors that do (diced vs whole tomatoes, unsalted butter, boneless skinless, low-sodium).
- quantity: the amount from the recipe in compact form ("2 1/2 cups", "3 cloves", "1 can (14 oz)"). Leave empty if the recipe gives none ("salt to taste").
- notes: only details that help at the store ("or margarine", "about 2 limes"). Leave empty otherwise.
- section: the store section where it's shelved. Canned and jarred goods, dried spices and baking supplies go in Pantry.
- staple: true only for salt, pepper, water, ice, cooking oils and cooking spray.

If the same product appears more than once (butter for the crust and the filling), output it once, list every source line, and combine the quantities ("4 tbsp + 1/2 cup").
Skip lines that aren't ingredients, such as section headings ("For the sauce:") or equipment.`;

export async function cleanWithClaude(recipeName: string, lines: string[]): Promise<ParsedIngredient[]> {
  if (!client) throw new Error("Claude is not configured");
  const numbered = lines.map((l, i) => `${i + 1}. ${l}`).join("\n");

  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    // Simple extraction: low effort keeps it quick for someone standing in the kitchen.
    output_config: { effort: "low", format: betaZodOutputFormat(Cleaned) },
    // If a safety classifier declines, retry server-side on Anthropic's recommended model.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM,
    messages: [{ role: "user", content: `Recipe: ${recipeName}\n\nIngredient lines:\n${numbered}` }],
  });

  if (response.stop_reason === "refusal") throw new Error("Claude declined to process this recipe");
  if (response.stop_reason === "max_tokens") throw new Error("Claude's answer was cut off");
  const parsed = response.parsed_output;
  if (!parsed || !parsed.items.length) throw new Error("Claude returned no items");

  return parsed.items
    .filter((it) => it.title.trim())
    .map((it) => ({
      original: it.sources
        .map((n) => lines[n - 1])
        .filter(Boolean)
        .join("\n"),
      title: it.title.trim(),
      quantity: it.quantity.trim(),
      notes: it.notes.trim(),
      section: it.section,
      staple: it.staple,
    }));
}
