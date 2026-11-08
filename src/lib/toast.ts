import { useSyncExternalStore } from "react";

/** One short message at the bottom of the screen, optionally with an Undo. A new one replaces the old. */
export interface Toast {
  id: number;
  message: string;
  undo?: () => void;
}

let current: Toast | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

const SHOW_MS = 5000;

export function showToast(message: string, undo?: () => void) {
  current = { id: nextId++, message, undo };
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
