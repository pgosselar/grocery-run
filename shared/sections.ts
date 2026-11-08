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
    "sweet potato", "yam", "jalapeno", "jalapeño", "fruit", "veggie", "vegetable", "sprout", "leek", "shallot",
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
    "yeast", "vanilla", "tuna", "salsa", "olive", "pickle", "crouton", "black pepper", "white pepper", "pepper flakes", "cayenne", "peppercorn", "chili powder", "oregano", "garlic powder", "onion powder", "bay lea", "salt and pepper", "breadcrumb", "panko", "cornstarch", "worcestershire", "diced tomatoes", "crushed tomatoes", "tomato sauce", "tomato paste", "canned tomatoes", "chicken broth", "chicken stock", "beef broth", "beef stock", "vegetable broth", "vegetable stock", "coconut milk", "tamari", "soy sauce", "sesame oil", "chili garlic sauce", "hot sauce", "sriracha", "fish sauce", "hoisin", "brown rice", "maple syrup", "thyme", "rosemary", "smoked paprika", "italian seasoning", "chili flakes", "quinoa", "dressing", "soy sauce", "nut", "almond", "seasoning",
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
 * Which section a new item goes in. The longest matching word wins, so "peanut butter" beats "butter",
 * and a word learned from a whole item name ("oat milk") beats the generic one ("milk").
 */
export function categorize(title: string, sections: ListSection[]): string {
  const t = ` ${title.toLowerCase()} `;
  let best = "";
  let bestLen = 0;
  for (const s of sections) {
    for (const w of s.keywords) {
      if (w.length > bestLen && t.includes(w)) {
        best = s.id;
        bestLen = w.length;
      }
    }
  }
  return best || fallbackSection(sections);
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
