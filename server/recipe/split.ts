// Split a pasted recipe into title, ingredients and steps without Claude. Most recipes copied from a
// page or a note have "Ingredients" and "Directions" headings; when they don't, guess line by line.
import type { RecipeLine } from "../../shared/types.ts";
import { stripTags } from "./extract.ts";

export interface SplitRecipe {
  title: string | null;
  servings: string | null;
  ingredients: RecipeLine[];
  steps: RecipeLine[];
  notes: string;
}

const INGREDIENTS = /^(?:the\s+)?ingredients?\s*:?$/i;
const STEPS = /^(?:directions|instructions|method|preparation|steps|how to make(?: it)?)\s*:?$/i;
const NOTES = /^(?:notes?|tips?|cook'?s notes?)\s*:?$/i;
const SERVINGS = /^(?:serves|servings|yield|yields|makes)\s*:?\s*(.+)$/i;
const NUMBERED = /^(?:step\s*)?\d+\s*[.):-]\s*/i;

/** A short line ending in a colon, like "For the sauce:" */
export function isHeading(line: string) {
  return line.length <= 60 && /:$/.test(line) && !/^\d/.test(line);
}

function looksLikeStep(line: string) {
  const words = line.split(/\s+/).length;
  return (NUMBERED.test(line) && words >= 5) || line.length > 110 || (/[.!]$/.test(line) && words >= 9);
}

const toLines = (lines: string[]): RecipeLine[] =>
  lines.map((l) => (isHeading(l) ? { text: l.replace(/:$/, "").trim(), heading: true } : { text: l }));

const toSteps = (lines: string[]): RecipeLine[] =>
  toLines(lines.map((l) => l.replace(NUMBERED, "").trim()).filter(Boolean));

export function splitPastedRecipe(text: string): SplitRecipe {
  let lines = text.split(/\r?\n/).map(stripTags).filter(Boolean);
  let servings: string | null = null;
  lines = lines.filter((l) => {
    const m = l.match(SERVINGS);
    if (m && !servings && l.length < 60) {
      servings = m[1].trim();
      return false;
    }
    return true;
  });

  const ingAt = lines.findIndex((l) => INGREDIENTS.test(l));
  const stepAt = lines.findIndex((l) => STEPS.test(l));
  const notesAt = lines.findIndex((l, i) => NOTES.test(l) && i > Math.max(ingAt, stepAt));
  const end = notesAt === -1 ? lines.length : notesAt;
  const notes = notesAt === -1 ? "" : lines.slice(notesAt + 1).join("\n");

  if (ingAt !== -1 || stepAt !== -1) {
    // Headings found: everything before the first one may be a title (and a blurb we drop).
    const first = Math.min(...[ingAt, stepAt].filter((i) => i !== -1));
    const title = first > 0 && lines[0].length <= 80 ? lines[0] : null;
    const ingLines =
      ingAt === -1 ? lines.slice(title ? 1 : 0, stepAt) : lines.slice(ingAt + 1, stepAt > ingAt ? stepAt : end);
    const stepLines = stepAt === -1 ? [] : lines.slice(stepAt + 1, ingAt > stepAt ? ingAt : end);
    return { title, servings, ingredients: toLines(ingLines), steps: toSteps(stepLines), notes };
  }

  // No headings: long sentences and numbered lines are steps, the rest are ingredients.
  const ing: string[] = [];
  const steps: string[] = [];
  for (const l of lines.slice(0, end)) (looksLikeStep(l) ? steps : ing).push(l);
  return { title: null, servings, ingredients: toLines(ing), steps: toSteps(steps), notes };
}
