import { useSyncExternalStore } from "react";

export type Route = { name: "lists" } | { name: "list"; id: string } | { name: "invite"; token: string }
  | { name: "reset"; token: string };

function parse(): Route {
  const m = location.hash.match(/^#\/list\/([\w-]+)/);
  if (m) return { name: "list", id: m[1] };
  const inv = location.hash.match(/^#\/invite\/([\w-]+)/);
  if (inv) return { name: "invite", token: inv[1] };
  const reset = location.hash.match(/^#\/reset\/([\w-]+)/);
  if (reset) return { name: "reset", token: reset[1] };
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

export function navigate(route: Route, replace = false) {
  const hash =
    route.name === "list" ? `#/list/${route.id}` : route.name === "lists" ? "#/" : `#/${route.name}/${route.token}`;
  // Mark entries we push, so Back only ever steps back within the app.
  if (replace) history.replaceState(history.state, "", hash);
  else history.pushState({ inApp: true }, "", hash);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

export function goBack() {
  // Opened straight from a shared link (or a bookmark): there's no in-app page behind us.
  if (current.name === "list" && history.state?.inApp) history.back();
  else navigate({ name: "lists" }, true);
}
