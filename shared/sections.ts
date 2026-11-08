// Store sections and auto-sorting. Every list has its own sections (a Costco run walks the store in a
// different order than Trader Joe's), each with the words that sort a new item into it.
import type { ListSection } from "./types.ts";

const DEFAULT_KEYWORDS: Record<string, string[]> = {
  Produce: [
    "tofu", "apple", "banana", "orange", "lemon", "lime", "grape", "berry", "berries", "strawberr", "blueberr", "raspberr",
    "avocado", "tomato", "potato", "onion", "garlic", "ginger", "lettuce", "spinach", "kale", "arugula", "salad",
    "carrot", "celery", "cucumber", "pepper", "broccoli", "cauliflower", "zucchini", "squash", "mushroom", "corn",
    "pear", "peach", "plum", "mango", "pineapple", "melon", "watermelon", "cherr", "kiwi", "herb", "cilantro",
    "parsley", "basil", "mint", "scallion", "green onion", "cabbage", "beet", "radish", "asparagus", "green bean",
    "sweet potato", "snap pea", "snow pea", "yam", "jalapeno", "jalapeño", "fruit", "veggie", "vegetable", "sprout", "leek", "shallot",
  ],
  Bakery: ["bread", "bagel", "bun", "roll", "baguette", "croissant", "muffin", "tortilla", "pita", "naan", "donut", "cake", "pie", "brioche", "sourdough", "english muffin"],
  "Meat & Seafood": [
    "chicken", "beef", "steak", "pork", "bacon", "sausage", "ground beef", "ground turkey", "ground pork", "turkey", "lamb", "ham", "fish", "salmon",
    "tuna steak", "shrimp", "cod", "tilapia", "crab", "lobster", "scallop", "meat", "ribs", "brisket", "hot dog", "chorizo",
  ],
  Deli: ["deli", "salami", "prosciutto", "pepperoni", "lunch meat", "sliced turkey", "hummus", "rotisserie"],
  "Dairy & Eggs": [
    "milk", "cheese", "cheddar", "mozzarella", "parmesan", "yogurt", "yoghurt", "butter", "cream", "egg",
    "sour cream", "cottage", "half and half", "half & half", "creamer", "kefir", "feta", "ricotta",
  ],
  Frozen: ["frozen", "ice cream", "popsicle", "peas", "frozen corn", "pizza", "waffle", "ice", "tater tot", "fries", "gelato"],
  Pantry: [
    "rice", "pasta", "spaghetti", "noodle", "flour", "sugar", "salt", "oil", "olive oil", "vinegar", "sauce",
    "ketchup", "mustard", "mayo", "cereal", "oat", "oatmeal", "bean", "lentil", "soup", "broth", "stock", "can ",
    "canned", "peanut butter", "jam", "jelly", "honey", "syrup", "spice", "cinnamon", "paprika", "cumin", "baking",
    "yeast", "vanilla", "tuna", "salsa", "olive", "pickle", "crouton", "black pepper", "white pepper", "pepper flakes", "cayenne", "peppercorn", "chili powder", "oregano", "garlic powder", "onion powder", "bay lea", "salt and pepper", "breadcrumb", "panko", "cornstarch", "worcestershire", "diced tomatoes", "crushed tomatoes", "tomato sauce", "tomato paste", "canned tomatoes", "chicken broth", "chicken stock", "beef broth", "beef stock", "vegetable broth", "vegetable stock", "coconut milk", "tamari", "soy sauce", "sesame oil", "chili garlic sauce", "hot sauce", "sriracha", "fish sauce", "hoisin", "brown rice", "maple syrup", "thyme", "rosemary", "smoked paprika", "italian seasoning", "chili flakes", "quinoa", "dressing", "soy sauce", "nut", "almond", "seasoning", "chickpea", "garbanzo",
  ],
  Snacks: ["chip", "cracker", "cookie", "pretzel", "popcorn", "granola", "bar", "candy", "chocolate", "snack", "goldfish", "trail mix"],
  Beverages: ["water", "juice", "soda", "coffee", "tea", "beer", "wine", "kombucha", "sparkling", "lemonade", "seltzer", "gatorade", "drink"],
  Household: [
    "paper towel", "toilet paper", "tissue", "napkin", "trash bag", "garbage bag", "detergent", "dish soap",
    "sponge", "foil", "plastic wrap", "ziploc", "zip lock", "bleach", "cleaner", "battery", "batteries", "light bulb",
    "dishwasher", "laundry", "wipes",
  ],
  "Personal Care": ["shampoo", "conditioner", "soap", "toothpaste", "toothbrush", "floss", "deodorant", "lotion", "razor", "sunscreen", "vitamin", "medicine", "tylenol", "advil", "band-aid", "bandaid"],
  Baby: ["diaper", "formula", "baby", "pacifier"],
  Pets: ["dog food", "cat food", "litter", "treats", "pet"],
};

/** The catch-all section. Every list has one; it can be renamed and moved but not deleted. */
export const OTHER = "other";

const DEFAULT_ORDER: [id: string, name: string][] = [
  ["produce", "Produce"], ["bakery", "Bakery"], ["meat", "Meat & Seafood"], ["deli", "Deli"], ["dairy", "Dairy & Eggs"],
  ["frozen", "Frozen"], ["pantry", "Pantry"], ["snacks", "Snacks"], ["beverages", "Beverages"], ["household", "Household"],
  ["personal", "Personal Care"], ["baby", "Baby"], ["pets", "Pets"], [OTHER, "Other"],
];

/** A fresh copy of the standard grocery-store sections, keywords included. */
export function defaultSections(): ListSection[] {
  return DEFAULT_ORDER.map(([id, name]) => ({ id, name, keywords: [...new Set(DEFAULT_KEYWORDS[name] ?? [])] }));
}

export function normalizeKeyword(word: string) {
  return word.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Words that say how something is stored, not what it is. They win wherever they appear in a name:
 * "frozen broccoli" goes to Frozen and "canned corn" to the pantry, even though broccoli and corn are produce.
 */
const FORM_WORDS = new Set(["frozen", "canned"]);

/**
 * Which section a new item goes in.
 * 1. A word learned from this exact item name always wins.
 * 2. A form word like "frozen" beats an ordinary word.
 * 3. Otherwise the match nearest the end of the name wins, because the last word usually says what the
 *    thing is: "chocolate milk" is milk, "milk chocolate" is chocolate, "orange juice" is juice.
 * 4. If two matches end at the same place, the longer one wins, so "peanut butter" beats "butter".
 */
export function categorize(title: string, sections: ListSection[]): string {
  const whole = normalizeKeyword(title);
  const t = ` ${whole} `;
  let best: { id: string; form: boolean; end: number; len: number } | null = null;
  for (const s of sections) {
    for (const w of s.keywords) {
      // Keywords may carry a meaningful trailing space ("can "), so match them as stored.
      const word = w.trim();
      if (!word) continue;
      if (word === whole) return s.id;
      const at = t.lastIndexOf(w);
      if (at === -1) continue;
      // Measure to the end of the word the match is in, so a stem ("chickpea", "strawberr") ties with a
      // plural-matching word ("peas", "berries") instead of losing to it.
      let end = at + w.trimEnd().length;
      while (end < t.length && /[\p{L}\p{N}]/u.test(t[end])) end++;
      const c = { id: s.id, form: word.split(" ").some((x) => FORM_WORDS.has(x)), end, len: word.length };
      if (!best || beats(c, best)) best = c;
    }
  }
  return best?.id ?? fallbackSection(sections);
}

function beats(a: { form: boolean; end: number; len: number }, b: { form: boolean; end: number; len: number }) {
  if (a.form !== b.form) return a.form;
  if (a.end !== b.end) return a.end > b.end;
  return a.len > b.len;
}

export function fallbackSection(sections: ListSection[]): string {
  return sections.find((s) => s.id === OTHER)?.id ?? sections[sections.length - 1]?.id ?? OTHER;
}

/** An item whose section was deleted (or came from another list) shows under the fallback section. */
export function resolveSection(sections: ListSection[], id: string): string {
  return sections.some((s) => s.id === id) ? id : fallbackSection(sections);
}

export function sectionName(sections: ListSection[], id: string): string {
  return sections.find((s) => s.id === id)?.name ?? sections.find((s) => s.id === fallbackSection(sections))?.name ?? "Other";
}

export function sectionRank(sections: ListSection[], id: string) {
  const i = sections.findIndex((s) => s.id === resolveSection(sections, id));
  return i === -1 ? sections.length : i;
}

/** Remember that items called `title` belong in `sectionId` on this list. */
export function learnSection(sections: ListSection[], title: string, sectionId: string): ListSection[] {
  const word = normalizeKeyword(title);
  if (!word || categorize(title, sections) === sectionId) return sections;
  return sections.map((s) => {
    const rest = s.keywords.filter((k) => k.trim() !== word);
    return s.id === sectionId ? { ...s, keywords: [...rest, word] } : rest.length === s.keywords.length ? s : { ...s, keywords: rest };
  });
}

/**
 * Undo `learnSection`: forget `title` as a word for `sectionId`, and give it back to the section that had
 * it before (if any).
 */
export function unlearnSection(sections: ListSection[], title: string, sectionId: string, previousOwner: string | null): ListSection[] {
  const word = normalizeKeyword(title);
  return sections.map((s) => {
    if (s.id === sectionId) return { ...s, keywords: s.keywords.filter((k) => k.trim() !== word) };
    if (s.id === previousOwner && !s.keywords.some((k) => k.trim() === word)) return { ...s, keywords: [...s.keywords, word] };
    return s;
  });
}

/** Which section, if any, has `title` itself as one of its words. */
export function sectionWithWord(sections: ListSection[], title: string): string | null {
  const word = normalizeKeyword(title);
  return sections.find((s) => s.keywords.some((k) => k.trim() === word))?.id ?? null;
}

/** "2 avocados" → { quantity: "2", title: "avocados" }; leaves "2% milk" alone. */
export function parseQuantity(input: string): { title: string; quantity: string } {
  const m = input.trim().match(/^(\d+(?:\.\d+)?|½|¼)\s*(x\s+)?(?=[a-zA-Z])(.+)$/);
  if (m && /\s|x/.test(input.trim().slice(m[1].length, m[1].length + 1))) {
    return { quantity: m[1], title: capitalize(m[3].trim()) };
  }
  const tail = input.trim().match(/^(.+?)\s+x\s?(\d+)$/i);
  if (tail) return { title: tail[1], quantity: tail[2] };
  return { title: input.trim(), quantity: "" };
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
