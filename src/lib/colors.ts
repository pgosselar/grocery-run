import type { ListColor } from "../../shared/types";

// iOS-style system colors for list badges — independent of the app theme.
export const LIST_COLORS: Record<ListColor, string> = {
  theme: "var(--primary)", // follows the tweakcn theme
  red: "#ff453a",
  orange: "#ff9f0a",
  yellow: "#ffd60a",
  green: "#30d158",
  teal: "#40c8e0",
  blue: "#0a84ff",
  indigo: "#5e5ce6",
  purple: "#bf5af2",
  pink: "#ff375f",
  brown: "#ac8e68",
  gray: "#8e8e93",
};

export const COLOR_NAMES = Object.keys(LIST_COLORS) as ListColor[];
