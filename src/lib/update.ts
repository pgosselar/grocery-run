// Keep the installed app up to date. A Home Screen app on iOS is usually resumed rather than relaunched,
// and a resumed app never asks for a new version on its own, so ask whenever it comes back to the front.
import { registerSW } from "virtual:pwa-register";
import { showToast } from "./toast";

/** An update that shows up this soon after opening the app is applied straight away. */
const RESUME_WINDOW_MS = 15_000;
const CHECK_EVERY_MS = 30 * 60_000;

let resumedAt = Date.now(); // a fresh launch counts too

/** Someone typing or with a sheet open would lose what they're doing if the page reloaded. */
function busy() {
  const el = document.activeElement;
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || !!document.querySelector('[role="dialog"]');
}

export function startUpdates() {
  if (!("serviceWorker" in navigator)) return;
  const update = registerSW({
    immediate: true,
    onNeedRefresh() {
      // Unsynced changes live in the outbox on this phone, so reloading never loses them.
      if (Date.now() - resumedAt < RESUME_WINDOW_MS && !busy()) void update(true);
      else showToast("A new version of the app is ready.", { label: "Update", run: () => void update(true) }, { sticky: true });
    },
    onRegisteredSW(_url, reg) {
      if (!reg) return;
      const check = () => {
        if (navigator.onLine) reg.update().catch(() => {});
      };
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState !== "visible") return;
        resumedAt = Date.now();
        check();
      });
      setInterval(check, CHECK_EVERY_MS);
    },
  });
}
