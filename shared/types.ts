export type ListColor =
  | "theme" | "red" | "orange" | "yellow" | "green" | "teal" | "blue" | "indigo" | "purple" | "pink" | "brown" | "gray";

/** One store section on one list. Order in the list = the order you walk the store. */
export interface ListSection {
  id: string;
  name: string;
  /** New items whose name contains one of these (lowercase) sort into this section */
  keywords: string[];
}

export interface GroceryList {
  id: string;
  name: string;
  color: ListColor;
  icon: string;
  /** Where this list sits on *your* lists screen (each person orders their own) */
  position: number;
  /** Group items into store sections (Produce, Dairy…) like the Reminders grocery list */
  grouped: boolean;
  sections: ListSection[];
  createdAt: number;
  updatedAt: number;
}

export interface User {
  id: string;
  name: string;
  email: string;
  hasPassword: boolean;
  hasGoogle: boolean;
  /** Can open the admin screen */
  admin?: boolean;
}

export interface Member {
  userId: string;
  name: string;
  role: "owner" | "member";
}

export interface AuthInfo {
  user: User | null;
  google: boolean;
  /** Can someone create an account right now (with the invite link they came with, if any)? */
  signupOpen: boolean;
  /** No accounts exist yet */
  firstRun: boolean;
  /** The server can send email (password reset links) */
  email: boolean;
  /** Recipes can be read from photos (needs Claude) */
  recipePhotos?: boolean;
}

/** What an invite link shows before you accept it. No `listName`: an invite to the app, not to a list. */
export interface InvitePreview {
  invitedBy: string;
  listName?: string;
  color?: ListColor;
  icon?: string;
  /** App invites: who it's for, to fill in the sign-up form */
  name?: string;
  email?: string;
}

export interface Item {
  id: string;
  listId: string;
  title: string;
  notes: string;
  quantity: string;
  /** Section id on this item's list */
  section: string;
  flagged: boolean;
  completed: boolean;
  completedAt: number | null;
  /** Name of whoever checked it off ("" for items from before this field existed) */
  completedBy?: string;
  completedById?: string;
  position: number;
  addedBy: string;
  addedById?: string;
  createdAt: number;
  updatedAt: number;
}

export type Op =
  | { type: "list.put"; list: GroceryList }
  | { type: "list.delete"; id: string; at: number }
  | { type: "item.put"; item: Item }
  | { type: "item.delete"; id: string; at: number }
  /** Your own order for the lists screen */
  | { type: "list.order"; ids: string[] };

export interface Snapshot {
  lists: GroceryList[];
  items: Item[];
  members: Record<string, Member[]>;
  version: number;
}

export type ServerMessage =
  | { type: "hello"; version: number }
  | { type: "ops"; ops: Op[]; version: number; origin: string }
  /** Something changed that ops can't express (you joined or left a list): fetch a fresh snapshot */
  | { type: "refresh" };

/** One check-off, kept server-side even after the item is cleared or deleted. */
export interface HistoryEntry {
  itemId: string;
  listId: string;
  title: string;
  quantity: string;
  section: string;
  addedBy: string;
  createdAt: number;
  completedBy: string;
  completedById?: string;
  completedAt: number;
}

/** One cleaned-up ingredient, ready to become a grocery item. */
export interface ParsedIngredient {
  /** The recipe line(s) it came from, for the preview */
  original: string;
  title: string;
  quantity: string;
  notes: string;
  section: string;
  /** Pantry staple (salt, oil, water…) — starts unticked in the preview */
  staple: boolean;
}

export interface RecipeImport {
  name: string;
  url: string | null;
  image: string | null;
  servings: string | null;
  ingredients: ParsedIngredient[];
  cleanedBy: "claude" | "rules";
  warning?: string;
  /** The whole recipe, ready to save to the recipe box. Absent when re-adding a saved recipe. */
  draft?: RecipeDraft;
  /** A saved recipe from the same link that this person can already see */
  existingId?: string | null;
}

/** One line of a recipe's ingredients or steps. Headings group what follows ("For the sauce"). */
export interface RecipeLine {
  text: string;
  heading?: boolean;
}

/** A cleaned-up shopping item kept with a saved recipe, so re-adding it needs no second cleanup. */
export interface ShoppingItem {
  original: string;
  title: string;
  quantity: string;
  notes: string;
  staple: boolean;
  /** Name of the section it was sorted into when imported; a hint for other lists with the same section */
  sectionHint?: string;
}

/** Everything about a recipe that its people can see and edit. */
export interface RecipeDraft {
  title: string;
  url: string | null;
  siteName: string | null;
  author: string | null;
  image: string | null;
  description: string;
  servings: string | null;
  times: { prep?: string; cook?: string; total?: string };
  ingredients: RecipeLine[];
  steps: RecipeLine[];
  notes: string;
  /** null after the ingredients were edited; rebuilt the next time it's added to a list */
  shopping: ShoppingItem[] | null;
}

export interface Recipe extends RecipeDraft {
  id: string;
  createdById: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  /** The lists it's tagged with that this person is on */
  lists: string[];
  /** Whether this person saved it (and so may delete it) */
  mine: boolean;
  /** A photo of the finished dish someone here took. Shown instead of the source site's image. */
  photo: DishPhoto | null;
}

export interface DishPhoto {
  url: string;
  thumb: string;
  addedBy: string;
  addedAt: number;
}

export interface RecipeSummary {
  id: string;
  title: string;
  /** The dish photo's thumbnail if there is one, else the source site's image */
  image: string | null;
  siteName: string | null;
  totalTime: string | null;
  lists: string[];
  updatedAt: number;
}

// ---------- admin ----------

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  signIn: ("password" | "google")[];
  admin: boolean;
  joinedAt: number;
  invitedBy: string | null;
  /** Last time any of their devices talked to the server (to within an hour) */
  lastActive: number | null;
  devices: number;
  listsOwned: number;
  listsShared: number;
  itemsAdded: number;
  itemsAddedWeek: number;
  checkedOff: number;
  checkedOffWeek: number;
  recipes: number;
  photos: number;
}

export interface AdminInvite {
  token: string;
  url: string;
  name: string;
  email: string | null;
  createdBy: string;
  createdAt: number;
  expiresAt: number;
  usedBy: { id: string; name: string } | null;
  usedAt: number | null;
}

export interface AdminOverview {
  users: AdminUser[];
  invites: AdminInvite[];
  totals: {
    users: number;
    activeWeek: number;
    lists: number;
    openItems: number;
    itemsAddedWeek: number;
    checkedOffWeek: number;
    recipes: number;
    photos: number;
  };
  server: {
    email: boolean;
    dbBytes: number;
    backups: { ok: boolean; lastBackup: string | null; problems: string[]; mirror: boolean };
  };
}
