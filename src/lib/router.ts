import { useSyncExternalStore } from "react";

export type Route =
  | { name: "lists" }
  | { name: "list"; id: string }
  | { name: "invite"; token: string }
  | { name: "reset"; token: string }
  | { name: "recipes"; list?: string }
  | { name: "recipe"; id: string; cook?: boolean };

function parse(): Route {
  const h = location.hash;
  let m: RegExpMatchArray | null;
  if ((m = h.match(/^#\/list\/([\w-]+)/))) return { name: "list", id: m[1] };
  if ((m = h.match(/^#\/invite\/([\w-]+)/))) return { name: "invite", token: m[1] };
  if ((m = h.match(/^#\/reset\/([\w-]+)/))) return { name: "reset", token: m[1] };
  if ((m = h.match(/^#\/recipes(?:\/([\w-]+))?/))) return m[1] ? { name: "recipes", list: m[1] } : { name: "recipes" };
  if ((m = h.match(/^#\/recipe\/([\w-]+)(\/cook)?/))) return m[2] ? { name: "recipe", id: m[1], cook: true } : { name: "recipe", id: m[1] };
  return { name: "lists" };
}

let current = parse();
const subs = new Set<() => void>();
window.addEventListener("hashchange", () => {
  current = parse();
  subs.forEach((s) => s());
});

export function useRoute() {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => current,
  );
}

function hashFor(route: Route) {
  switch (route.name) {
    case "lists": return "#/";
    case "list": return `#/list/${route.id}`;
    case "recipes": return route.list ? `#/recipes/${route.list}` : "#/recipes";
    case "recipe": return `#/recipe/${route.id}${route.cook ? "/cook" : ""}`;
    default: return `#/${route.name}/${route.token}`;
  }
}

export function navigate(route: Route, replace = false) {
  const hash = hashFor(route);
  // Mark entries we push, so Back only ever steps back within the app.
  if (replace) history.replaceState(history.state, "", hash);
  else history.pushState({ inApp: true }, "", hash);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

/** Back within the app; opened straight from a link or bookmark, go to `fallback` instead of leaving. */
export function goBack(fallback: Route = { name: "lists" }) {
  if (history.state?.inApp) history.back();
  else navigate(fallback, true);
}
