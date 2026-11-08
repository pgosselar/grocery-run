import { useEffect, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Sun, X } from "lucide-react";
import type { Recipe } from "../../shared/types";
import { safeStorage, saveStorage } from "@/lib/utils";
import { cn } from "@/lib/utils";

/**
 * Full-screen cooking view: big type, ingredients to tick off, steps to step through, and the screen kept
 * awake. Progress is remembered on this phone, so leaving to check a timer doesn't lose your place.
 */
export function CookMode({ recipe, color, onClose }: { recipe: Recipe; color: string; onClose: () => void }) {
  const key = `gr.cook.${recipe.id}`;
  const [progress, setProgress] = useState(() =>
    safeStorage<{ done: number[]; step: number; at: number }>(key, { done: [], step: 0, at: 0 }),
  );
  // Start fresh if the last session was more than half a day ago.
  const fresh = Date.now() - progress.at > 12 * 3600_000;
  const done = new Set(fresh ? [] : progress.done);
  const steps = recipe.steps.map((l, i) => ({ ...l, i })).filter((l) => !l.heading);
  const current = fresh ? 0 : Math.min(progress.step, Math.max(steps.length - 1, 0));
  const awake = useWakeLock();
  const stepRefs = useRef<(HTMLElement | null)[]>([]);

  const update = (p: Partial<typeof progress>) => {
    const next = { done: [...done], step: current, ...p, at: Date.now() };
    setProgress(next);
    saveStorage(key, next);
  };
  const toggle = (i: number) => {
    const d = new Set(done);
    if (d.has(i)) d.delete(i);
    else d.add(i);
    update({ done: [...d] });
  };
  const go = (s: number) => {
    const n = Math.max(0, Math.min(steps.length - 1, s));
    update({ step: n });
    stepRefs.current[n]?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  // Steps are numbered within each heading's group, like the recipe page.
  let n = 0;
  let stepIndex = -1;

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-background">
      <header className="pt-safe border-b bg-background/90 px-3 pb-2 backdrop-blur-xl">
        <div className="flex h-10 items-center gap-2">
          <button aria-label="Close cooking mode" onClick={onClose} className="rounded-full p-1.5 active:bg-accent">
            <X className="size-6" />
          </button>
          <h1 className="min-w-0 flex-1 truncate text-center text-[17px] font-semibold">{recipe.title}</h1>
          <span className={cn("flex items-center gap-1 text-xs", awake ? "" : "invisible")} style={{ color }} title="The screen stays on while cooking">
            <Sun className="size-4" /> On
          </span>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-5xl gap-6 px-4 pt-4 pb-32 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          {recipe.ingredients.length > 0 && (
            <section>
              <h2 className="mb-2 text-xl font-bold">Ingredients</h2>
              <ul className="space-y-0.5">
                {recipe.ingredients.map((l, i) =>
                  l.heading ? (
                    <li key={i} className="pt-3 pb-1 text-sm font-semibold tracking-wide text-muted-foreground uppercase">{l.text}</li>
                  ) : (
                    <li key={i}>
                      <button onClick={() => toggle(i)} className="flex w-full items-start gap-3 rounded-lg px-1 py-2 text-left active:bg-accent">
                        <span
                          className="mt-1 flex size-6 shrink-0 items-center justify-center rounded-md border-2"
                          style={done.has(i) ? { backgroundColor: color, borderColor: color, color: "white" } : { borderColor: "color-mix(in oklab, var(--muted-foreground) 45%, transparent)" }}
                        >
                          {done.has(i) && <Check className="size-4" strokeWidth={3} />}
                        </span>
                        <span className={cn("text-[19px] leading-snug", done.has(i) && "text-muted-foreground line-through")}>{l.text}</span>
                      </button>
                    </li>
                  ),
                )}
              </ul>
            </section>
          )}

          {steps.length > 0 && (
            <section>
              <h2 className="mb-2 text-xl font-bold">Steps</h2>
              <ol className="space-y-2">
                {recipe.steps.map((l, i) => {
                  if (l.heading) {
                    n = 0;
                    return <li key={i} className="pt-3 pb-1 text-sm font-semibold tracking-wide text-muted-foreground uppercase">{l.text}</li>;
                  }
                  n++;
                  const s = ++stepIndex;
                  const active = s === current;
                  return (
                    <li key={i} ref={(el) => { stepRefs.current[s] = el; }}>
                      <button
                        onClick={() => update({ step: s })}
                        className={cn(
                          "flex w-full gap-3 rounded-xl border-2 p-3 text-left transition-colors",
                          active ? "bg-card shadow-sm" : "border-transparent",
                          s < current && "opacity-50",
                        )}
                        style={active ? { borderColor: color } : undefined}
                      >
                        <span
                          className="flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-bold"
                          style={active ? { backgroundColor: color, color: "white" } : { backgroundColor: "var(--muted)" }}
                        >
                          {n}
                        </span>
                        <span className="text-[20px] leading-relaxed">{l.text}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </section>
          )}
        </div>
      </div>

      {steps.length > 1 && (
        <footer className="pb-safe border-t bg-background/90 px-4 pt-3 backdrop-blur-xl">
          <div className="mx-auto flex max-w-5xl items-center gap-3">
            <button
              onClick={() => go(current - 1)}
              disabled={current === 0}
              className="flex h-12 items-center gap-1 rounded-xl bg-muted px-4 font-medium disabled:opacity-40"
            >
              <ChevronLeft className="size-5" /> Back
            </button>
            <span className="flex-1 text-center text-sm text-muted-foreground tabular-nums">
              Step {current + 1} of {steps.length}
            </span>
            <button
              onClick={() => go(current + 1)}
              disabled={current === steps.length - 1}
              className="flex h-12 items-center gap-1 rounded-xl px-5 font-semibold text-white disabled:opacity-40"
              style={{ backgroundColor: color }}
            >
              Next <ChevronRight className="size-5" />
            </button>
          </div>
        </footer>
      )}
    </div>
  );
}

/** Keep the screen on while mounted (where the browser allows it). Re-acquired after the app comes back. */
function useWakeLock() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    let live = true;
    const acquire = async () => {
      try {
        if (!("wakeLock" in navigator) || document.visibilityState !== "visible") return;
        lock = await navigator.wakeLock.request("screen");
        if (!live) return void lock.release();
        setOn(true);
        lock.addEventListener("release", () => live && setOn(false));
      } catch {
        setOn(false);
      }
    };
    const onVisible = () => document.visibilityState === "visible" && acquire();
    void acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      live = false;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release().catch(() => {});
    };
  }, []);
  return on;
}
