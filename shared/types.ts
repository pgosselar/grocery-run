export type ListColor =
  | "theme" | "red" | "orange" | "yellow" | "green" | "teal" | "blue" | "indigo" | "purple" | "pink" | "brown" | "gray";

export interface GroceryList {
  id: string;
  name: string;
  color: ListColor;
  icon: string;
  position: number;
  /** Group items into store sections (Produce, Dairy…) like the Reminders grocery list */
  grouped: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Item {
  id: string;
  listId: string;
  title: string;
  notes: string;
  quantity: string;
  section: string;
  flagged: boolean;
  completed: boolean;
  completedAt: number | null;
  /** Name of whoever checked it off ("" for items from before this field existed) */
  completedBy?: string;
  position: number;
  addedBy: string;
  createdAt: number;
  updatedAt: number;
}

export type Op =
  | { type: "list.put"; list: GroceryList }
  | { type: "list.delete"; id: string; at: number }
  | { type: "item.put"; item: Item }
  | { type: "item.delete"; id: string; at: number };

export interface Snapshot {
  lists: GroceryList[];
  items: Item[];
  version: number;
}

export type ServerMessage =
  | { type: "hello"; version: number }
  | { type: "ops"; ops: Op[]; version: number; origin: string };

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
