import { useEffect, useState } from "react";
import { BookOpen, ChefHat, ChevronLeft, Clock, Loader2, Plus, Search, WifiOff, X } from "lucide-react";
import type { RecipeSummary } from "../../shared/types";
import { sortedLists, useStore } from "@/lib/store";
import { searchRecipes } from "@/lib/recipes";
import { goBack, navigate } from "@/lib/router";
import { LIST_COLORS } from "@/lib/colors";
import { cn } from "@/lib/utils";
import { RecipeImportSheet } from "./RecipeImportSheet";

/** The recipe box: everything saved to the lists you're on, searchable, filterable by list. */
export function RecipesScreen({ list }: { list?: string }) {
  const state = useStore();
  const lists = sortedLists(state);
  const [q, setQ] = useState("");
  const [recipes, setRecipes] = useState<RecipeSummary[] | null>(null);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const filter = list && state.lists[list] ? list : undefined;

  useEffect(() => {
    let live = true;
    const t = setTimeout(
      () =>
        searchRecipes(q, filter)
          .then((r) => {
            if (!live) return;
            setRecipes(r.recipes);
            setOffline(r.offline);
            setError(null);
          })
          .catch((e: Error) => live && setError(e.message)),
      q ? 200 : 0,
    );
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, filter, importOpen]);

  const setFilter = (id?: string) => navigate({ name: "recipes", list: id }, true);

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col">
      <header className="pt-safe sticky top-0 z-10 bg-background/85 px-4 pb-2 backdrop-blur-xl">
        <div className="-ml-2 flex h-10 items-center justify-between">
          <button className="text-primary flex items-center text-[17px]" onClick={() => goBack()}>
            <ChevronLeft className="size-7" strokeWidth={2.25} /> Lists
          </button>
          <button className="text-primary flex items-center gap-1 text-[17px] font-medium" onClick={() => setImportOpen(true)}>
            <Plus className="size-5" strokeWidth={2.5} /> Import
          </button>
        </div>
        <h1 className="text-[34px] leading-tight font-bold tracking-tight">Recipes</h1>
        <div className="relative mt-2">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search titles, ingredients, steps"
            className="w-full rounded-xl bg-muted py-2 pr-9 pl-9 text-[16px] outline-none placeholder:text-muted-foreground/70 [&::-webkit-search-cancel-button]:hidden"
          />
          {q && (
            <button aria-label="Clear search" onClick={() => setQ("")} className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full p-1 text-muted-foreground">
              <X className="size-4" />
            </button>
          )}
        </div>
        {lists.length > 1 && (
          <div className="-mx-4 mt-2 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
            <Chip active={!filter} onClick={() => setFilter()}>All</Chip>
            {lists.map((l) => (
              <Chip key={l.id} active={filter === l.id} color={LIST_COLORS[l.color]} onClick={() => setFilter(l.id)}>
                {l.name}
              </Chip>
            ))}
          </div>
        )}
      </header>

      <main className="flex-1 px-4 pt-2 pb-16">
        {offline && (
          <p className="mb-3 flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
            <WifiOff className="size-4 shrink-0" /> Offline: showing recipes this phone has seen. Searching titles only.
          </p>
        )}
        {error && <p className="mb-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        {recipes === null ? (
          !error && <div className="flex justify-center pt-16"><Loader2 className="size-7 animate-spin text-muted-foreground" /></div>
        ) : recipes.length === 0 ? (
          <Empty searching={!!q} listName={filter ? state.lists[filter]?.name : undefined} onImport={() => setImportOpen(true)} />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {recipes.map((r) => (
              <Card key={r.id} recipe={r} />
            ))}
          </div>
        )}
      </main>

      <RecipeImportSheet open={importOpen} onClose={() => setImportOpen(false)} listId={undefined} />
    </div>
  );
}

function Card({ recipe }: { recipe: RecipeSummary }) {
  const state = useStore();
  const tags = recipe.lists.map((id) => state.lists[id]).filter(Boolean);
  return (
    <button
      onClick={() => navigate({ name: "recipe", id: recipe.id })}
      className="flex flex-col overflow-hidden rounded-xl bg-card text-left shadow-sm active:opacity-80"
    >
      <div className="aspect-[4/3] w-full bg-muted">
        {recipe.image ? (
          <img src={recipe.image} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center text-muted-foreground/60">
            <ChefHat className="size-9" />
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-2.5">
        <div className="line-clamp-2 text-[15px] leading-snug font-semibold">{recipe.title}</div>
        <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {tags.map((l) => (
            <span key={l.id} className="flex items-center gap-1">
              <span className="size-2 rounded-full" style={{ backgroundColor: LIST_COLORS[l.color] }} />
              {l.name}
            </span>
          ))}
          {recipe.totalTime && (
            <span className="flex items-center gap-1">
              <Clock className="size-3" /> {recipe.totalTime}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

function Chip({ active, color, onClick, children }: { active: boolean; color?: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
        active ? "border-transparent text-white" : "bg-card text-foreground",
      )}
      style={active ? { backgroundColor: color ?? "var(--primary)" } : undefined}
    >
      {children}
    </button>
  );
}

function Empty({ searching, listName, onImport }: { searching: boolean; listName?: string; onImport: () => void }) {
  if (searching) return <p className="pt-16 text-center text-muted-foreground">No recipes match.</p>;
  return (
    <div className="flex flex-col items-center px-6 pt-14 text-center">
      <div className="bg-primary/10 text-primary mb-5 flex size-20 items-center justify-center rounded-full">
        <BookOpen className="size-10" />
      </div>
      <h2 className="text-xl font-semibold">{listName ? `No recipes on ${listName} yet` : "No recipes yet"}</h2>
      <p className="mt-1 text-muted-foreground">
        Recipes you import are saved here, with their steps, for everyone on the list. Come back to cook from one or to
        add its ingredients again.
      </p>
      <button onClick={onImport} className="bg-primary text-primary-foreground mt-6 rounded-full px-6 py-3 font-medium">
        Import a Recipe
      </button>
    </div>
  );
}
