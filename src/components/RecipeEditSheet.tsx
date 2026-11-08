import { useEffect, useState } from "react";
import type { Recipe, RecipeLine } from "../../shared/types";
import { Sheet } from "@/components/ui/sheet";
import { Input, Textarea } from "@/components/ui/input";
import { editRecipe } from "@/lib/recipes";

/** One line each; a short line ending in ":" is a heading ("For the sauce:"). */
const toText = (lines: RecipeLine[]) => lines.map((l) => (l.heading ? `${l.text}:` : l.text)).join("\n");
const fromText = (text: string): RecipeLine[] =>
  text
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => (l.length <= 60 && l.endsWith(":") ? { text: l.slice(0, -1).trim(), heading: true } : { text: l }));

export function RecipeEditSheet({
  recipe,
  open,
  onClose,
  onSaved,
}: {
  recipe: Recipe;
  open: boolean;
  onClose: () => void;
  onSaved: (r: Recipe) => void;
}) {
  const [title, setTitle] = useState("");
  const [servings, setServings] = useState("");
  const [ingredients, setIngredients] = useState("");
  const [steps, setSteps] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(recipe.title);
    setServings(recipe.servings ?? "");
    setIngredients(toText(recipe.ingredients));
    setSteps(toText(recipe.steps));
    setNotes(recipe.notes);
    setError(null);
  }, [open]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      onSaved(
        await editRecipe(recipe.id, {
          title: title.trim(),
          servings: servings.trim() || null,
          ingredients: fromText(ingredients),
          steps: fromText(steps),
          notes: notes.trim(),
        }),
      );
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setBusy(false);
    }
  };

  const label = "px-1 text-sm font-medium text-muted-foreground";
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()} title="Edit Recipe" onDone={save} doneLabel={busy ? "…" : "Save"} doneDisabled={busy || !title.trim()}>
      <div className="space-y-4 pb-4">
        <div className="space-y-1.5">
          <label className={label}>Title</label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <label className={label}>Serves</label>
          <Input value={servings} onChange={(e) => setServings(e.target.value)} placeholder="4" />
        </div>
        <div className="space-y-1.5">
          <label className={label}>Ingredients</label>
          <Textarea rows={8} value={ingredients} onChange={(e) => setIngredients(e.target.value)} />
          <p className="px-1 text-xs text-muted-foreground">One per line. End a line with a colon to make it a heading, like “For the sauce:”.</p>
        </div>
        <div className="space-y-1.5">
          <label className={label}>Steps</label>
          <Textarea rows={10} value={steps} onChange={(e) => setSteps(e.target.value)} />
          <p className="px-1 text-xs text-muted-foreground">One step per line.</p>
        </div>
        <div className="space-y-1.5">
          <label className={label}>Notes</label>
          <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Swaps, oven quirks, who liked it…" />
        </div>
        {error && <p className="px-1 text-sm text-destructive">{error}</p>}
      </div>
    </Sheet>
  );
}
