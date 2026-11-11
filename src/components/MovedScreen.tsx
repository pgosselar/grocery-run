import { useEffect } from "react";
import { Loader2, Share, ShoppingBasket } from "lucide-react";
import type { AuthInfo } from "../../shared/types";
import { useStore } from "@/lib/store";

/** The app's new home, when this copy is running at an old address (Grocery Run at gr.homelab…). */
export function movedTo(info: AuthInfo): URL | null {
  if (!info.publicUrl) return null;
  try {
    const home = new URL(info.publicUrl);
    return home.origin === location.origin ? null : home;
  } catch {
    return null;
  }
}

const standalone = () =>
  matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

/**
 * Sign-ins and unsynced changes belong to an address, so finish syncing here first, then go. A Home Screen
 * app can't move itself (its icon points here), so it explains how to add the new one instead.
 */
export function MovedScreen({ to }: { to: URL }) {
  const { user, pending } = useStore();
  // Changes left by someone who's signed out can't be saved anywhere, so don't wait on them.
  const waiting = user ? pending : 0;
  const target = new URL(location.pathname + location.search + location.hash, to).href;
  const installed = standalone();

  useEffect(() => {
    if (!installed && waiting === 0) location.replace(target);
  }, [installed, waiting, target]);

  return (
    <div className="pt-safe pb-safe flex min-h-dvh items-center justify-center px-6 py-10">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div className="bg-primary text-primary-foreground mx-auto flex size-20 items-center justify-center rounded-[1.4rem] shadow-lg">
          <ShoppingBasket className="size-10" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">Grocery Run is now Lane Nine</h1>
          <p className="text-muted-foreground">Same lists, same recipes, new name and address: {to.host}</p>
        </div>
        {waiting > 0 ? (
          <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Saving {waiting} change{waiting === 1 ? "" : "s"} from this phone first… (this needs a connection)
          </p>
        ) : installed ? (
          <>
            <ol className="space-y-2 rounded-xl bg-card p-4 text-left text-sm shadow-sm">
              <li>1. Open {to.host} in Safari and sign in (same email and password).</li>
              <li>
                2. Tap <Share className="inline size-4 align-[-2px]" /> Share, then <b>Add to Home Screen</b>.
              </li>
              <li>3. Delete this old icon.</li>
            </ol>
            <a
              href={target}
              target="_blank"
              rel="noopener"
              className="bg-primary text-primary-foreground block rounded-full px-6 py-3 font-medium"
            >
              Open {to.host}
            </a>
          </>
        ) : (
          <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Taking you there…
          </p>
        )}
      </div>
    </div>
  );
}
