// Pull the ingredient list out of a recipe page. Nearly every recipe site publishes
// schema.org Recipe data as JSON-LD for Google, which is far cleaner than scraping text.

import type { RecipeLine } from "../../shared/types.ts";
import { normalizeTime } from "../../shared/time.ts";

export interface ExtractedRecipe {
  name: string;
  ingredients: string[];
  image: string | null;
  servings: string | null;
  steps: RecipeLine[];
  description: string;
  author: string | null;
  siteName: string | null;
  times: { prep?: string; cook?: string; total?: string };
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

/** "PT1H15M" → "1 hr 15 min"; sites that put plain text there ("15 minutes") get tidied too. */
export function formatDuration(v: Json | undefined): string | undefined {
  return normalizeTime(text(v));
}

/** schema.org recipeInstructions: a string, a list of strings, HowToSteps, or HowToSections of HowToSteps. */
export function instructionLines(v: Json | undefined, depth = 0): RecipeLine[] {
  if (v == null || depth > 4) return [];
  if (typeof v === "string") {
    // One blob of HTML or text: split on paragraphs, list items and line breaks.
    return v
      .split(/<\/(?:p|li|div)>|<br\s*\/?>|\n+/i)
      .map(stripTags)
      .filter(Boolean)
      .map((t) => ({ text: t }));
  }
  if (Array.isArray(v)) return v.flatMap((x) => instructionLines(x, depth + 1));
  if (typeof v !== "object") return [];
  const type = v["@type"];
  const isSection = type === "HowToSection" || (Array.isArray(type) && type.includes("HowToSection"));
  if (isSection || (v.itemListElement && !v.text)) {
    const name = text(v.name);
    const inner = instructionLines(v.itemListElement ?? null, depth + 1);
    return name ? [{ text: name, heading: true }, ...inner] : inner;
  }
  const t = text(v.text) ?? text(v.name);
  return t ? [{ text: t }] : [];
}

function authorName(v: Json | undefined): string | null {
  if (Array.isArray(v)) return authorName(v[0]);
  if (typeof v === "string") return stripTags(v) || null;
  if (v && typeof v === "object" && typeof v.name === "string") return stripTags(v.name) || null;
  return null;
}

function metaContent(html: string, prop: string): string | null {
  const re = new RegExp(`<meta[^>]*(?:property|name)=["']${prop}["'][^>]*content=["']([^"']+)["']`, "i");
  const alt = new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']${prop}["']`, "i");
  const m = html.match(re) ?? html.match(alt);
  return m ? stripTags(m[1]) || null : null;
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
      steps: instructionLines(recipe.recipeInstructions),
      description: (text(recipe.description) ?? "").slice(0, 1000),
      author: authorName(recipe.author),
      siteName: metaContent(html, "og:site_name"),
      times: {
        prep: formatDuration(recipe.prepTime),
        cook: formatDuration(recipe.cookTime),
        total: formatDuration(recipe.totalTime),
      },
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
  if (!micro.length) return null;
  const steps: RecipeLine[] = [];
  const el = /<(li|p|div|ol)[^>]*itemprop=["']recipeInstructions["'][^>]*>([\s\S]*?)<\/\1>/gi;
  for (const m of html.matchAll(el)) steps.push(...instructionLines(m[2]));
  return {
    name: pageTitle(html),
    ingredients: micro,
    image: metaContent(html, "og:image"),
    servings: null,
    steps,
    description: metaContent(html, "og:description")?.slice(0, 1000) ?? "",
    author: null,
    siteName: metaContent(html, "og:site_name"),
    times: {},
  };
}
