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
}

export interface InvitePreview {
  listName: string;
  invitedBy: string;
  color: ListColor;
  icon: string;
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
}
