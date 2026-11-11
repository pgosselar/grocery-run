import { useEffect, useState } from "react";
import { Loader2, Unlink } from "lucide-react";
import type { InvitePreview } from "../../shared/types";
import { Button } from "@/components/ui/button";
import { acceptInvite, previewInvite } from "@/lib/store";
import { navigate } from "@/lib/router";
import { LIST_COLORS } from "@/lib/colors";
import { ListIcon } from "@/lib/icons";

/** Someone who's already signed in opened a share link. */
export function InviteScreen({ token }: { token: string }) {
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    previewInvite(token).then(setPreview).catch((e: Error) => setError(e.message));
  }, [token]);

  const join = async () => {
    setBusy(true);
    try {
      navigate({ name: "list", id: await acceptInvite(token) }, true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't join the list");
      setBusy(false);
    }
  };

  return (
    <div className="pt-safe flex min-h-dvh items-center justify-center px-6">
      <div className="w-full max-w-sm space-y-6 text-center">
        {error ? (
          <>
            <Unlink className="mx-auto size-14 text-muted-foreground" />
            <p className="text-muted-foreground">{error}</p>
          </>
        ) : !preview ? (
          <Loader2 className="mx-auto size-8 animate-spin text-muted-foreground" />
        ) : !preview.listName ? (
          <>
            <img src="/icon.svg" alt="" className="mx-auto size-20 rounded-[1.4rem] shadow-lg" />
            <div>
              <h1 className="text-2xl font-bold tracking-tight">You're already in</h1>
              <p className="mt-1 text-muted-foreground">
                This link is for making a new account{preview.name ? ` (it's for ${preview.name})` : ""}. You're signed in already, so
                there's nothing to do.
              </p>
            </div>
            <Button size="lg" className="w-full" onClick={() => navigate({ name: "lists" }, true)}>Go to My Lists</Button>
          </>
        ) : (
          <>
            <div
              className="mx-auto flex size-20 items-center justify-center rounded-full text-white shadow-lg"
              style={{ backgroundColor: LIST_COLORS[preview.color ?? "theme"] }}
            >
              <ListIcon name={preview.icon ?? ""} className="size-10" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Join “{preview.listName}”?</h1>
              <p className="mt-1 text-muted-foreground">
                {preview.invitedBy} shared this list with you. Everyone on it can add, check off and edit items.
              </p>
            </div>
            <Button size="lg" className="w-full" disabled={busy} onClick={join} style={{ backgroundColor: LIST_COLORS[preview.color ?? "theme"] }}>
              {busy ? "Joining…" : "Join List"}
            </Button>
          </>
        )}
        {(error || preview?.listName) && (
          <button className="text-primary text-sm" onClick={() => navigate({ name: "lists" }, true)}>
            {error ? "Go to my lists" : "Not now"}
          </button>
        )}
      </div>
    </div>
  );
}
