// Rule-based cleanup: "2 ½ cups all-purpose flour, sifted" → Flour · Qty "2 1/2 cups" · notes "sifted".
// Works offline and costs nothing; the Claude path (claude.ts) does better on messy lines.
import type { ListSection, ParsedIngredient } from "../../shared/types.ts";
import { categorize } from "../../shared/sections.ts";
import { decodeEntities } from "./extract.ts";

const FRACTIONS: Record<string, string> = {
  "½": "1/2", "⅓": "1/3", "⅔": "2/3", "¼": "1/4", "¾": "3/4", "⅕": "1/5", "⅖": "2/5", "⅗": "3/5", "⅘": "4/5",
  "⅙": "1/6", "⅚": "5/6", "⅛": "1/8", "⅜": "3/8", "⅝": "5/8", "⅞": "7/8",
};

const UNITS = [
  "cups?", "c\\.", "tablespoons?", "tbsps?\\.?", "tbs\\.?", "T\\.?", "teaspoons?", "tsps?\\.?", "t\\.",
  "ounces?", "oz\\.?", "fl\\.? ?oz\\.?", "fluid ounces?", "pounds?", "lbs?\\.?", "grams?", "g", "kilograms?", "kgs?",
  "milliliters?", "millilitres?", "ml", "liters?", "litres?", "l", "quarts?", "qts?\\.?", "pints?", "pts?\\.?",
  "gallons?", "cloves?", "cans?", "jars?", "bottles?", "bags?", "boxe?s?", "packages?", "pkgs?\\.?", "packets?",
  "containers?", "cartons?", "sticks?", "slices?", "pieces?", "pcs?\\.?", "heads?", "bunche?s?", "sprigs?",
  "stalks?", "ribs?", "leaves", "leaf", "pinche?s?", "dashe?s?", "handfuls?", "drops?", "fillets?", "links?",
  "large", "medium", "small", "heaping", "level",
].join("|");

const NUM = String.raw`(?:\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)`;
const QTY_RE = new RegExp(
  String.raw`^(${NUM}(?:\s*(?:-|–|to)\s*${NUM})?)\s*((?:(?:${UNITS})\b\.?\s*)*)(?:of\s+)?`,
  "i",
);
// "a pinch of", "a handful of"
const ARTICLE_RE = new RegExp(String.raw`^(an?)\s+((?:${UNITS})\b\.?)\s+(?:of\s+)?`, "i");

const PREP = [
  "fresh", "freshly", "finely", "coarsely", "roughly", "thinly", "thickly", "lightly", "very", "about", "approximately",
  "chopped", "minced", "diced", "sliced", "grated", "shredded", "crushed", "cubed", "halved", "quartered", "peeled",
  "seeded", "trimmed", "julienned", "torn", "packed", "firmly", "loosely", "softened", "melted", "cold", "warm",
  "room-temperature", "room", "temperature", "beaten", "divided", "rinsed", "drained", "cooked", "uncooked", "raw",
  "and", "or",
];
const PREP_RE = new RegExp(String.raw`^(?:(?:${PREP.join("|")})[,\s]+)+`, "i");
const PREP_TAIL_RE = new RegExp(String.raw`(?:[,\s]+(?:${PREP.filter((w) => !["and", "or", "fresh", "raw"].includes(w)).join("|")}))+$`, "i");

const TAIL_NOTES = /\s*(?:,?\s*(?:plus more|or more|to taste|as needed|for serving|for garnish|for frying|optional|if desired|divided)\b.*)$/i;

// Things most kitchens already have. They start unticked in the preview.
const STAPLES = new Set([
  "salt", "kosher salt", "sea salt", "table salt", "pepper", "black pepper", "ground black pepper", "salt and pepper",
  "kosher salt and pepper", "salt and black pepper", "water", "warm water", "cold water", "hot water", "boiling water",
  "ice", "ice water", "olive oil", "extra-virgin olive oil", "extra virgin olive oil", "vegetable oil", "canola oil",
  "neutral oil", "oil", "cooking spray", "nonstick cooking spray", "nonstick spray",
]);

function normalize(line: string): string {
  let s = decodeEntities(line)
    .replace(/[▢☐□•●◦∙·*]/g, " ")
    .replace(/(\d)([½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])/g, "$1 $2");
  for (const [k, v] of Object.entries(FRACTIONS)) s = s.replaceAll(k, ` ${v}`);
  return s.replace(/⁄/g, "/").replace(/\s+/g, " ").replace(/^[-–\s]+/, "").trim();
}

function capitalize(s: string) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** Section headers like "For the sauce:" or "FROSTING" aren't ingredients. */
function isHeader(line: string) {
  return (/:$/.test(line) && !/\d/.test(line)) || /^for the\b/i.test(line);
}

export function parseIngredientLine(line: string, sections: ListSection[]): ParsedIngredient | null {
  const original = line.replace(/\s+/g, " ").trim();
  let s = normalize(original);
  if (!s || isHeader(s)) return null;

  const notes: string[] = [];
  let size = "";

  // Budget-recipe sites append per-line costs: "1 onion ($0.32)"
  s = s.replace(/\(?\s*\$\d+(?:\.\d+)?\s*\)?/g, " ");
  // Commas that are part of the product name, not prep: "boneless, skinless chicken"
  s = s.replace(/\b(boneless|skinless|bone-in|skin-on),\s*(?=boneless|skinless|bone-in|skin-on)/gi, "$1 ");

  // Parentheticals (innermost first, so "((minced))" works): sizes like "(14 oz)" join
  // the quantity; anything else becomes a note.
  for (let guard = 0; guard < 5 && /\([^()]*\)/.test(s); guard++) {
    s = s.replace(/\(([^()]*)\)/g, (_, inner: string) => {
      const t = inner.trim();
      if (!t) return " ";
      if (/^(about\s+)?\d[\d\s/.-]*\s*(oz|ounce|g|gram|ml|lb|pound|inch|in\b|-inch)/i.test(t)) size = t;
      else notes.push(t);
      return " ";
    });
  }
  s = s.replace(/[()*]/g, " ").replace(/\s+/g, " ").trim();

  // Quantity + unit at the front
  let quantity = "";
  const q = s.match(QTY_RE);
  if (q && q[0].trim()) {
    quantity = `${q[1]} ${q[2] ?? ""}`.replace(/\s+/g, " ").trim();
    s = s.slice(q[0].length);
  } else {
    const a = s.match(ARTICLE_RE);
    if (a) {
      quantity = `1 ${a[2]}`.trim();
      s = s.slice(a[0].length);
    }
  }
  if (size) quantity = quantity ? `${quantity} (${size})` : size;

  // Everything after the first comma is prep: "onion, finely chopped"
  const comma = s.indexOf(",");
  if (comma > 0) {
    notes.unshift(s.slice(comma + 1).trim());
    s = s.slice(0, comma);
  }
  const tail = s.match(TAIL_NOTES);
  if (tail) {
    notes.push(tail[0].replace(/^[\s,]+/, ""));
    s = s.slice(0, tail.index);
  }

  // Canned/jarred goods keep their descriptor ("Diced tomatoes") and live in Pantry.
  const packaged = /\b(cans?|jars?|bottles?|cartons?)\b/i.test(quantity);
  if (!packaged) s = s.replace(PREP_RE, "").replace(PREP_TAIL_RE, "").trim();
  // "butter or margarine" → Butter, note "or margarine" (but not "long- or short-grain rice")
  const or = s.match(/^(.+?)\s+or\s+(.+)$/i);
  if (or && !/salt|pepper/i.test(s) && !/-$/.test(or[1])) {
    s = or[1];
    notes.push(`or ${or[2]}`);
  }
  s = s.replace(/^(of|the)\s+/i, "").replace(/[\s,.;:-]+$/, "").trim();
  if (!s) return null;

  let title = capitalize(s);
  let lower = title.toLowerCase();
  if (/\bsalt\b/.test(lower) && /\bpepper\b/.test(lower)) {
    title = "Salt and pepper";
    lower = "salt and pepper";
  }
  let section = categorize(title, sections);
  // "1 can diced tomatoes" matched a produce word, but cans live in the pantry aisle.
  if (packaged && section === "produce" && sections.some((x) => x.id === "pantry")) section = "pantry";
  return {
    original,
    title,
    quantity,
    notes: notes.filter(Boolean).join("; "),
    section,
    staple: STAPLES.has(lower) || /^(salt|pepper|water)\b/.test(lower),
  };
}

/** Same ingredient listed twice (butter for the crust and the filling) becomes one item. */
export function mergeDuplicates(items: ParsedIngredient[]): ParsedIngredient[] {
  const byTitle = new Map<string, ParsedIngredient>();
  for (const it of items) {
    const key = it.title.toLowerCase();
    const prev = byTitle.get(key);
    if (!prev) {
      byTitle.set(key, { ...it });
      continue;
    }
    prev.quantity = [prev.quantity, it.quantity].filter(Boolean).join(" + ");
    prev.notes = [...new Set([...prev.notes.split("; "), ...it.notes.split("; ")].filter(Boolean))].join("; ");
    prev.original = `${prev.original}\n${it.original}`;
  }
  return [...byTitle.values()];
}

export function parseIngredientsWithRules(lines: string[], sections: ListSection[]): ParsedIngredient[] {
  return mergeDuplicates(lines.map((l) => parseIngredientLine(l, sections)).filter((x): x is ParsedIngredient => x !== null));
}
