import { useSyncExternalStore } from "react";

export type Route = { name: "lists" } | { name: "list"; id: string };

function parse(): Route {
  const m = location.hash.match(/^#\/list\/([\w-]+)/);
  return m ? { name: "list", id: m[1] } : { name: "lists" };
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

export function navigate(route: Route) {
  location.hash = route.name === "list" ? `#/list/${route.id}` : "#/";
}

export function goBack() {
  if (history.length > 1 && current.name === "list") history.back();
  else navigate({ name: "lists" });
}
