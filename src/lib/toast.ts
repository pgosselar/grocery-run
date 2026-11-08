import { useSyncExternalStore } from "react";

/** One short message at the bottom of the screen, optionally with an Undo. A new one replaces the old. */
export interface Toast {
  id: number;
  message: string;
  action?: { label: string; run: () => void };
}

let current: Toast | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

const SHOW_MS = 5000;

/** A plain function as the action means Undo. */
export function showToast(message: string, action?: (() => void) | { label: string; run: () => void }) {
  current = { id: nextId++, message, action: typeof action === "function" ? { label: "Undo", run: action } : action };
  clearTimeout(timer);
  timer = setTimeout(dismissToast, SHOW_MS);
  emit();
}

export function dismissToast() {
  clearTimeout(timer);
  current = null;
  emit();
}

export function useToast(): Toast | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}
