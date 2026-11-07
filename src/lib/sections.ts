// Store-section auto-categorization, like the Reminders "Groceries" list type.
export const SECTIONS = [
  "Produce", "Bakery", "Meat & Seafood", "Deli", "Dairy & Eggs", "Frozen", "Pantry", "Snacks",
  "Beverages", "Household", "Personal Care", "Baby", "Pets", "Other",
] as const;

const KEYWORDS: Record<string, string[]> = {
  Produce: [
    "apple", "banana", "orange", "lemon", "lime", "grape", "berry", "berries", "strawberr", "blueberr", "raspberr",
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
  Frozen: ["frozen", "ice cream", "popsicle", "pizza", "waffle", "ice", "tater tot", "fries", "gelato"],
  Pantry: [
    "rice", "pasta", "spaghetti", "noodle", "flour", "sugar", "salt", "oil", "olive oil", "vinegar", "sauce",
    "ketchup", "mustard", "mayo", "cereal", "oat", "oatmeal", "bean", "lentil", "soup", "broth", "stock", "can ",
    "canned", "peanut butter", "jam", "jelly", "honey", "syrup", "spice", "cinnamon", "paprika", "cumin", "baking",
    "yeast", "vanilla", "tuna", "salsa", "olive", "pickle", "crouton", "quinoa", "dressing", "soy sauce", "nut", "almond", "seasoning",
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

// Longest keyword wins so "peanut butter" beats "butter" and "ice cream" beats "cream".
const ENTRIES = Object.entries(KEYWORDS)
  .flatMap(([section, words]) => words.map((w) => [w, section] as const))
  .sort((a, b) => b[0].length - a[0].length);

export function categorize(title: string): string {
  const t = ` ${title.toLowerCase()} `;
  for (const [word, section] of ENTRIES) if (t.includes(word)) return section;
  return "Other";
}

export function sectionRank(section: string) {
  const i = (SECTIONS as readonly string[]).indexOf(section);
  return i === -1 ? SECTIONS.length : i;
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
