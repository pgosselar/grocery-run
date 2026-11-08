import { useEffect, useState } from "react";
import {
  ChefHat, ChevronLeft, Clock, CookingPot, Ellipsis, ExternalLink, ListPlus, Loader2, Pencil, Trash2, Unlink, Users, X,
} from "lucide-react";
import type { Recipe, RecipeLine } from "../../shared/types";
import { useStore } from "@/lib/store";
import { cachedRecipe, deleteRecipe, getRecipe, untagRecipe } from "@/lib/recipes";
import { goBack, navigate } from "@/lib/router";
import { LIST_COLORS } from "@/lib/colors";
import { showToast } from "@/lib/toast";
import { formatWhen } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RecipeImportSheet } from "./RecipeImportSheet";
import { RecipeEditSheet } from "./RecipeEditSheet";
import { CookMode } from "./CookMode";

export function RecipeScreen({ id, cook }: { id: string; cook: boolean }) {
  const state = useStore();
  const [recipe, setRecipe] = useState<Recipe | null>(() => cachedRecipe(id));
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    getRecipe(id).then(setRecipe).catch((e: Error) => setError(e.message));
  }, [id]);

  if (!recipe) {
    return (
      <div className="pt-safe mx-auto flex min-h-dvh max-w-2xl flex-col px-4">
        <BackBar />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 pb-24 text-center text-muted-foreground">
          {error ? <><Unlink className="size-12" /><p>{error}</p></> : <Loader2 className="size-8 animate-spin" />}
        </div>
      </div>
    );
  }

  const tags = recipe.lists.map((l) => state.lists[l]).filter(Boolean);
  const color = tags[0] ? LIST_COLORS[tags[0].color] : "var(--primary)";
  const meta = [
    recipe.servings && `Serves ${recipe.servings.replace(/\s*servings?/i, "")}`,
    recipe.times.prep && `Prep ${recipe.times.prep}`,
    recipe.times.cook && `Cook ${recipe.times.cook}`,
    recipe.times.total && `Total ${recipe.times.total}`,
  ].filter(Boolean);

  const untag = async (listId: string, name: string) => {
    try {
      const r = await untagRecipe(recipe.id, listId);
      if (r) setRecipe(r);
      else goBack({ name: "recipes" });
      showToast(r ? `Removed from ${name}.` : `Removed from ${name}. It's no longer on any of your lists.`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Couldn't remove it.");
    }
  };

  const remove = async () => {
    try {
      await deleteRecipe(recipe.id);
      showToast(`Deleted “${recipe.title}”.`);
      goBack({ name: "recipes" });
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Couldn't delete it.");
    }
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col">
      <header className="pt-safe sticky top-0 z-10 bg-background/85 px-2 backdrop-blur-xl">
        <div className="flex h-10 items-center justify-between">
          <button className="flex items-center text-[17px]" style={{ color }} onClick={() => goBack({ name: "recipes" })}>
            <ChevronLeft className="size-7" strokeWidth={2.25} /> Recipes
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger className="flex size-9 items-center justify-center rounded-full outline-none" style={{ color }} aria-label="Recipe options">
              <Ellipsis className="size-6" />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={() => setEditOpen(true)}>
                Edit Recipe <Pencil />
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setAddOpen(true)}>
                Add to a List <ListPlus />
              </DropdownMenuItem>
              {tags.length > 0 && <DropdownMenuSeparator />}
              {tags.map((l) => (
                <DropdownMenuItem key={l.id} onSelect={() => untag(l.id, l.name)}>
                  Remove from {l.name} <X />
                </DropdownMenuItem>
              ))}
              {recipe.mine && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem destructive onSelect={() => setConfirmDelete(true)}>
                    Delete Recipe <Trash2 />
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <main className="flex-1 px-4 pb-24">
        {recipe.image && (
          <img src={recipe.image} alt="" referrerPolicy="no-referrer" className="mb-4 aspect-[16/10] w-full rounded-2xl object-cover shadow-sm" />
        )}
        <h1 className="text-[28px] leading-tight font-bold tracking-tight">{recipe.title}</h1>
        {(recipe.siteName || recipe.author) && (
          <p className="mt-1 text-sm text-muted-foreground">
            {recipe.url ? (
              <a href={recipe.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline-offset-2 hover:underline" style={{ color }}>
                From {[recipe.author, recipe.siteName].filter(Boolean).join(" at ")} <ExternalLink className="size-3.5" />
              </a>
            ) : recipe.siteName ? (
              <>From {recipe.siteName}{recipe.author ? ` by ${recipe.author}` : ""}</>
            ) : (
              <>By {recipe.author}</>
            )}
          </p>
        )}
        {recipe.description && <p className="mt-3 text-[15px] text-muted-foreground">{recipe.description}</p>}

        {meta.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2 text-sm">
            {meta.map((m) => (
              <span key={m} className="flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-muted-foreground">
                {m!.startsWith("Serves") ? <Users className="size-3.5" /> : <Clock className="size-3.5" />} {m}
              </span>
            ))}
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {tags.length ? (
            tags.map((l) => (
              <button key={l.id} onClick={() => navigate({ name: "list", id: l.id })} className="flex items-center gap-1.5 rounded-full border bg-card px-3 py-1">
                <span className="size-2 rounded-full" style={{ backgroundColor: LIST_COLORS[l.color] }} /> {l.name}
              </button>
            ))
          ) : (
            <span>Not on any of your lists. Only you can see it.</span>
          )}
        </div>

        <div className="mt-4 flex gap-2">
          <Button size="lg" className="flex-1" style={{ backgroundColor: color }} onClick={() => navigate({ name: "recipe", id, cook: true })}>
            <CookingPot /> Cook
          </Button>
          <Button size="lg" variant="secondary" className="flex-1" onClick={() => setAddOpen(true)}>
            <ListPlus /> Add to List
          </Button>
        </div>

        {confirmDelete && (
          <div className="mt-4 space-y-2 rounded-xl bg-card p-4 shadow-sm">
            <p className="text-sm text-muted-foreground">
              Delete “{recipe.title}” for everyone? Items already on your lists stay.
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setConfirmDelete(false)}>Keep</Button>
              <Button variant="destructive" className="flex-1" onClick={remove}>Delete</Button>
            </div>
          </div>
        )}

        <Lines title="Ingredients" lines={recipe.ingredients} />
        <Lines title="Steps" lines={recipe.steps} numbered />
        {recipe.notes && (
          <section className="mt-6">
            <h2 className="mb-2 text-xl font-bold">Notes</h2>
            <p className="whitespace-pre-line text-[16px] leading-relaxed">{recipe.notes}</p>
          </section>
        )}

        <p className="mt-8 text-center text-xs text-muted-foreground">
          Saved by {recipe.createdBy} · {formatWhen(recipe.createdAt)}
        </p>
      </main>

      <RecipeImportSheet open={addOpen} onClose={() => setAddOpen(false)} recipeId={recipe.id} onTagged={setRecipe} />
      <RecipeEditSheet recipe={recipe} open={editOpen} onClose={() => setEditOpen(false)} onSaved={setRecipe} />
      {cook && <CookMode recipe={recipe} color={color} onClose={() => goBack({ name: "recipe", id })} />}
    </div>
  );
}

function BackBar() {
  return (
    <div className="-ml-2 flex h-10 items-center">
      <button className="text-primary flex items-center text-[17px]" onClick={() => goBack({ name: "recipes" })}>
        <ChevronLeft className="size-7" strokeWidth={2.25} /> Recipes
      </button>
    </div>
  );
}

/** Ingredients or steps, with group headings; steps are numbered, restarting under each heading. */
export function Lines({ title, lines, numbered }: { title: string; lines: RecipeLine[]; numbered?: boolean }) {
  if (!lines.length) return null;
  let n = 0;
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-xl font-bold">{title}</h2>
      <div className="rounded-xl bg-card px-4 py-1 shadow-sm">
        {lines.map((l, i) => {
          if (l.heading) {
            n = 0;
            return <h3 key={i} className="pt-3 pb-1 text-sm font-semibold tracking-wide text-muted-foreground uppercase">{l.text}</h3>;
          }
          n++;
          return numbered ? (
            <div key={i} className="flex gap-3 border-b py-3 last:border-b-0">
              <span className="w-5 shrink-0 text-right font-semibold text-muted-foreground tabular-nums">{n}</span>
              <p className="text-[16px] leading-relaxed">{l.text}</p>
            </div>
          ) : (
            <div key={i} className="flex gap-3 border-b py-2.5 text-[16px] last:border-b-0">
              <ChefHat className="mt-1 size-3.5 shrink-0 text-muted-foreground/50" />
              {l.text}
            </div>
          );
        })}
      </div>
    </section>
  );
}
