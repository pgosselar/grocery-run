// Nudging people on a phone to add the app to their Home Screen, where it opens full screen and works
// offline. Remembered per device (adding is per device): "Not now" snoozes a week, or never ask again.
import { useSyncExternalStore } from "react";
import { safeStorage, saveStorage } from "./utils";

const KEY = "gr.homescreen";
const SNOOZE_MS = 7 * 864e5;

interface Pref {
  snoozedUntil?: number;
  never?: boolean;
}

/** Started from the Home Screen icon, rather than in a browser tab */
export const isStandalone = () =>
  matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

/** Phones and tablets that can add a web app to the Home Screen; null for computers. */
export function homeScreenPlatform(): "ios" | "android" | null {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return "ios";
  if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return "ios"; // iPadOS asks for the desktop site
  if (/Android/.test(ua)) return "android";
  return null;
}

/** Apps like Instagram or Gmail open links in their own viewer, which can't add to the Home Screen. */
export const inAppBrowser = () => /FBAN|FBAV|Instagram|Line\/|GSA\/|LinkedInApp|Snapchat/.test(navigator.userAgent);

// ---------- Android's own install dialog ----------

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let installEvent: InstallPromptEvent | null = null;
let open = false;
const subs = new Set<() => void>();
let snapshot = { installable: false, open: false };
const notify = () => {
  snapshot = { installable: !!installEvent, open };
  subs.forEach((s) => s());
};

// Chrome on Android offers its own install dialog; hold on to it so our button can show it.
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installEvent = e as InstallPromptEvent;
  notify();
});
window.addEventListener("appinstalled", () => {
  installEvent = null;
  open = false;
  notify();
});

/** Shows Android's install dialog. True if they installed. */
export async function installNow(): Promise<boolean> {
  if (!installEvent) return false;
  const ev = installEvent;
  installEvent = null;
  await ev.prompt();
  const { outcome } = await ev.userChoice;
  notify();
  return outcome === "accepted";
}

// ---------- when to ask ----------

const pref = () => safeStorage<Pref>(KEY, {});

/** On a phone, in the browser, and not snoozed or turned off */
export function shouldAsk(now = Date.now()) {
  if (!homeScreenPlatform() || isStandalone()) return false;
  const p = pref();
  return !p.never && !(p.snoozedUntil && p.snoozedUntil > now);
}

export function openHomeScreenPrompt() {
  open = true;
  notify();
}

/** "Not now", or swiped away: ask again in a week. */
export function snoozeHomeScreenPrompt() {
  saveStorage(KEY, { snoozedUntil: Date.now() + SNOOZE_MS });
  open = false;
  notify();
}

export function neverAskHomeScreen() {
  saveStorage(KEY, { never: true });
  open = false;
  notify();
}

/** From Account: show the instructions now, and undo "Don't ask again". */
export function showHomeScreenHelp() {
  saveStorage(KEY, {});
  openHomeScreenPrompt();
}

export function closeHomeScreenPrompt() {
  open = false;
  notify();
}

export function useHomeScreenPrompt() {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => snapshot,
  );
}
