// Pull the ingredient list out of a recipe page. Nearly every recipe site publishes
// schema.org Recipe data as JSON-LD for Google, which is far cleaner than scraping text.

export interface ExtractedRecipe {
  name: string;
  ingredients: string[];
  image: string | null;
  servings: string | null;
}

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘",
  rdquo: "”", ldquo: "“", frac12: "½", frac14: "¼", frac34: "¾", frac13: "⅓", frac23: "⅔", deg: "°", hellip: "…",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

export function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

function isRecipe(node: { [k: string]: Json }) {
  const t = node["@type"];
  return t === "Recipe" || (Array.isArray(t) && t.includes("Recipe"));
}

function findRecipe(node: Json, depth = 0): { [k: string]: Json } | null {
  if (!node || typeof node !== "object" || depth > 6) return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const r = findRecipe(n, depth + 1);
      if (r) return r;
    }
    return null;
  }
  if (isRecipe(node)) return node;
  for (const key of ["@graph", "mainEntity", "mainEntityOfPage", "itemListElement", "item"]) {
    const r = findRecipe(node[key] ?? null, depth + 1);
    if (r) return r;
  }
  return null;
}

function text(v: Json | undefined): string | null {
  if (typeof v === "string") return stripTags(v);
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return text(v[0]);
  if (v && typeof v === "object") return text(v.url ?? v.name ?? v["@id"]);
  return null;
}

function fromJsonLd(html: string): ExtractedRecipe | null {
  const re = /<script[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    let data: Json;
    try {
      data = JSON.parse(m[1].trim().replace(/^<!--|-->$/g, "").replace(/^\/\/<!\[CDATA\[|\/\/\]\]>$/g, ""));
    } catch {
      continue;
    }
    const recipe = findRecipe(data);
    if (!recipe) continue;
    const raw = recipe.recipeIngredient ?? recipe.ingredients;
    const list = (Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/\n/) : [])
      .map((x) => (typeof x === "string" ? stripTags(x) : ""))
      .filter(Boolean);
    if (!list.length) continue;
    return {
      name: text(recipe.name) ?? "Recipe",
      ingredients: list,
      image: text(recipe.image),
      servings: text(recipe.recipeYield),
    };
  }
  return null;
}

function fromMicrodata(html: string): string[] {
  const out: string[] = [];
  const meta = /<meta[^>]*itemprop=["'](?:recipeIngredient|ingredients)["'][^>]*content=["']([^"']+)["']/gi;
  for (const m of html.matchAll(meta)) out.push(stripTags(m[1]));
  const el = /<(li|span|p|div)[^>]*itemprop=["'](?:recipeIngredient|ingredients)["'][^>]*>([\s\S]*?)<\/\1>/gi;
  for (const m of html.matchAll(el)) out.push(stripTags(m[2]));
  return out.filter(Boolean);
}

function pageTitle(html: string): string {
  const og = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
  const t = og?.[1] ?? html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "Recipe";
  return stripTags(t).replace(/\s*[|–—-]\s*[^|–—-]+$/, "") || "Recipe";
}

export function extractRecipe(html: string): ExtractedRecipe | null {
  const ld = fromJsonLd(html);
  if (ld) return ld;
  const micro = fromMicrodata(html);
  if (micro.length) return { name: pageTitle(html), ingredients: micro, image: null, servings: null };
  return null;
}
