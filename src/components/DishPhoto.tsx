import { useState } from "react";
import { Camera, Images, Loader2 } from "lucide-react";
import type { Recipe } from "../../shared/types";
import { prepareDishPhoto } from "@/lib/images";
import { setDishPhoto } from "@/lib/recipes";
import { showToast } from "@/lib/toast";
import { cn } from "@/lib/utils";

/** Shrink and upload a photo of the finished dish. */
export function useDishPhotoUpload(recipe: Recipe, onSaved: (r: Recipe) => void) {
  const [busy, setBusy] = useState(false);
  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      onSaved(await setDishPhoto(recipe.id, await prepareDishPhoto(file)));
      showToast(recipe.photo ? "Photo replaced." : "Photo added.");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Couldn't save the photo.");
    } finally {
      setBusy(false);
    }
  };
  return { busy, upload };
}

/**
 * A hidden file input wrapped in whatever's inside. `camera` opens the camera straight away; without it,
 * iPhones offer the camera or the photo library.
 */
export function PhotoInput({
  camera,
  onFile,
  className,
  style,
  children,
  label,
}: {
  camera?: boolean;
  onFile: (f: File | undefined) => void;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
  label?: string;
}) {
  return (
    <label className={cn("cursor-pointer", className)} style={style} aria-label={label}>
      {children}
      <input
        type="file"
        accept="image/*"
        {...(camera ? { capture: "environment" as const } : {})}
        className="sr-only"
        onChange={(e) => {
          onFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </label>
  );
}

/** The picture at the top of a recipe: the dish photo, else the source site's, else a place to add one. */
export function DishHero({ recipe, color, onSaved }: { recipe: Recipe; color: string; onSaved: (r: Recipe) => void }) {
  const { busy, upload } = useDishPhotoUpload(recipe, onSaved);
  const src = recipe.photo?.url ?? recipe.image;
  const spinner = busy && (
    <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-black/30 text-white">
      <Loader2 className="size-8 animate-spin" />
    </div>
  );

  if (!src) {
    return (
      <div className="relative mb-4">
        <PhotoInput
          onFile={upload}
          className={cn(
            "flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed py-5 text-[15px] font-medium",
            busy && "pointer-events-none opacity-60",
          )}
          style={{ color }}
        >
          <Camera className="size-5" /> Add a photo of the dish
        </PhotoInput>
        {spinner}
      </div>
    );
  }
  return (
    <div className="relative mb-4">
      <img
        src={src}
        alt={recipe.photo ? `${recipe.title}, as made by ${recipe.photo.addedBy}` : ""}
        referrerPolicy="no-referrer"
        className="aspect-[16/10] w-full rounded-2xl bg-muted object-cover shadow-sm"
      />
      <PhotoInput
        onFile={upload}
        label={recipe.photo ? "Change the dish photo" : "Use your own photo of the dish"}
        className={cn(
          "absolute right-2.5 bottom-2.5 flex items-center gap-1.5 rounded-full bg-black/55 px-3 py-1.5 text-sm font-medium text-white backdrop-blur",
          busy && "pointer-events-none opacity-0",
        )}
      >
        <Camera className="size-4" /> {recipe.photo ? "Change" : "Your photo"}
      </PhotoInput>
      {spinner}
    </div>
  );
}

/** Shown when someone finishes cooking a recipe that has no photo of its own yet. */
export function DishPhotoPrompt({
  recipe,
  color,
  onSaved,
  onDone,
}: {
  recipe: Recipe;
  color: string;
  onSaved: (r: Recipe) => void;
  onDone: () => void;
}) {
  const { busy, upload } = useDishPhotoUpload(recipe, (r) => {
    onSaved(r);
    onDone();
  });
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-4 sm:items-center" onClick={busy ? undefined : onDone}>
      <div
        role="dialog"
        aria-label="Add a photo of the dish"
        className="pb-safe w-full max-w-sm rounded-2xl bg-card p-5 text-center shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 flex size-14 items-center justify-center rounded-full" style={{ backgroundColor: `color-mix(in oklab, ${color} 15%, transparent)`, color }}>
          {busy ? <Loader2 className="size-7 animate-spin" /> : <Camera className="size-7" />}
        </div>
        <h2 className="text-lg font-semibold">How did it turn out?</h2>
        <p className="mt-1 text-sm text-muted-foreground">Snap the finished dish and it becomes this recipe's picture.</p>
        <div className={cn("mt-4 space-y-2", busy && "pointer-events-none opacity-50")}>
          <PhotoInput camera onFile={upload} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl font-semibold text-white" style={{ backgroundColor: color }}>
            <Camera className="size-5" /> Take a Photo
          </PhotoInput>
          <PhotoInput onFile={upload} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-muted font-medium">
            <Images className="size-5" /> Choose a Photo
          </PhotoInput>
          <button onClick={onDone} className="h-11 w-full text-[15px] text-muted-foreground">
            Not Now
          </button>
        </div>
      </div>
    </div>
  );
}
