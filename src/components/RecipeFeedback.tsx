import { useState } from "react";
import { Loader2, Star, X } from "lucide-react";
import type { Recipe } from "../../shared/types";
import { addComment, averageStars, deleteComment, rateRecipe } from "@/lib/recipes";
import { useStore } from "@/lib/store";
import { showToast } from "@/lib/toast";
import { cn, formatWhen } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";

/** Read-only stars to the nearest half, e.g. ★★★★½ for an average of 4.5. */
export function Stars({ value, className }: { value: number; className?: string }) {
  const halves = Math.round(value * 2) / 2;
  return (
    <span className={cn("inline-flex items-center gap-px", className)} aria-label={`${value.toFixed(1)} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => {
        const fill = Math.min(1, Math.max(0, halves - (i - 1)));
        return (
          <span key={i} className="relative inline-flex size-[1em]">
            <Star className="size-full text-muted-foreground/40" />
            {fill > 0 && (
              <span className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
                <Star className="size-[1em] fill-amber-400 text-amber-400" />
              </span>
            )}
          </span>
        );
      })}
    </span>
  );
}

/** Under the title: the average and how many rated it; taps through to the ratings and comments below. */
export function RatingSummary({ recipe }: { recipe: Recipe }) {
  const avg = averageStars(recipe);
  const comments = recipe.comments?.length ?? 0;
  if (avg == null && !comments) return null;
  const n = recipe.ratings.length;
  return (
    <button
      className="mt-2 flex items-center gap-2 text-sm text-muted-foreground"
      onClick={() => document.getElementById("feedback")?.scrollIntoView({ behavior: "smooth" })}
    >
      {avg != null && (
        <>
          <Stars value={avg} className="text-base" />
          <span>
            {avg.toFixed(1).replace(/\.0$/, "")} · {n} rating{n === 1 ? "" : "s"}
          </span>
        </>
      )}
      {avg != null && comments > 0 && <span>·</span>}
      {comments > 0 && <span>{comments} comment{comments === 1 ? "" : "s"}</span>}
    </button>
  );
}

/** Everyone's stars and comments, and a place to add yours. */
export function RecipeFeedback({ recipe, color, onChange }: { recipe: Recipe; color: string; onChange: (r: Recipe) => void }) {
  const online = useStore().online !== false;
  const ratings = recipe.ratings ?? [];
  const comments = recipe.comments ?? [];
  const mine = ratings.find((r) => r.me)?.stars ?? 0;
  const others = ratings.filter((r) => !r.me);
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const [pendingStars, setPendingStars] = useState<number | null>(null);

  const rate = async (stars: number) => {
    const next = stars === mine ? 0 : stars; // tap your rating again to take it back
    setPendingStars(next);
    try {
      onChange(await rateRecipe(recipe.id, next));
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Couldn't save your rating.");
    } finally {
      setPendingStars(null);
    }
  };

  const post = async () => {
    if (!text.trim()) return;
    setPosting(true);
    try {
      onChange(await addComment(recipe.id, text.trim()));
      setText("");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Couldn't post that.");
    } finally {
      setPosting(false);
    }
  };

  const remove = async (id: string) => {
    try {
      onChange(await deleteComment(id));
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Couldn't delete it.");
    }
  };

  const shown = pendingStars ?? mine;

  return (
    <section id="feedback" className="mt-6 scroll-mt-16">
      <h2 className="mb-2 text-xl font-bold">Ratings & Comments</h2>
      <div className="space-y-3 rounded-xl bg-card p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[15px]">Your rating</span>
          <div className="flex items-center" role="radiogroup" aria-label="Your rating">
            {[1, 2, 3, 4, 5].map((i) => (
              <button
                key={i}
                role="radio"
                aria-checked={shown === i}
                aria-label={`${i} star${i === 1 ? "" : "s"}`}
                disabled={pendingStars != null || !online}
                onClick={() => rate(i)}
                className="p-1 disabled:opacity-60"
              >
                <Star className={cn("size-7 transition-colors", i <= shown ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40")} />
              </button>
            ))}
          </div>
        </div>
        {others.length > 0 && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {others.map((r) => (
              <span key={r.name} className="flex items-center gap-1.5">
                {r.name} <Stars value={r.stars} className="text-xs" />
              </span>
            ))}
          </div>
        )}
      </div>

      {comments.length > 0 && (
        <div className="mt-3 divide-y overflow-hidden rounded-xl bg-card shadow-sm">
          {comments.map((c) => (
            <div key={c.id} className="flex gap-2 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">{c.by}</span> · {formatWhen(c.at)}
                </div>
                <p className="mt-0.5 text-[15px] whitespace-pre-line">{c.text}</p>
              </div>
              {(c.mine || recipe.mine) && online && (
                <button aria-label="Delete comment" onClick={() => remove(c.id)} className="-mr-1 self-start p-1 text-muted-foreground">
                  <X className="size-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 space-y-2">
        <Textarea
          rows={2}
          placeholder={comments.length ? "Add a comment…" : "Made it? How did it go? Any changes next time?"}
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={!online}
        />
        {text.trim() && (
          <Button className="w-full" style={{ backgroundColor: color }} disabled={posting} onClick={post}>
            {posting ? <Loader2 className="animate-spin" /> : null} Post Comment
          </Button>
        )}
        {!online && <p className="text-center text-xs text-muted-foreground">Ratings and comments need a connection.</p>}
      </div>
    </section>
  );
}
