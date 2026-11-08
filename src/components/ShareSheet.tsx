import { useEffect, useState } from "react";
import { Check, Copy, LogOut, RotateCcw, Share, X } from "lucide-react";
import type { GroceryList } from "../../shared/types";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { getInviteLink, removeMember, useStore } from "@/lib/store";
import { navigate } from "@/lib/router";

export function Avatar({ name, color, className = "size-9" }: { name: string; color: string; className?: string }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white ${className}`}
      style={{ backgroundColor: color }}
    >
      {initials}
    </span>
  );
}

/** Who's on a list, the invite link, and removing people / leaving. */
export function ShareSheet({ list, open, onClose, color }: { list: GroceryList; open: boolean; onClose: () => void; color: string }) {
  const state = useStore();
  const me = state.user!;
  const members = state.members[list.id] ?? [];
  const isOwner = members.find((m) => m.userId === me.id)?.role !== "member";
  const [link, setLink] = useState<{ url: string; expiresAt: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null); // userId to remove, or "leave"/"reset"

  useEffect(() => {
    if (!open) return;
    setError(null);
    setConfirm(null);
    getInviteLink(list.id).then(setLink).catch((e: Error) => setError(e.message));
  }, [open, list.id]);

  // navigator.share / clipboard only exist over HTTPS (or localhost).
  const canShare = typeof navigator.share === "function";
  const shareLink = async () => {
    if (!link) return;
    try {
      await navigator.share({ title: `Join “${list.name}” on Grocery Run`, url: link.url });
    } catch {
      /* cancelled */
    }
  };
  const copyLink = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Couldn't copy. Press and hold the link to copy it.");
    }
  };

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work");
    }
    setConfirm(null);
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()} title="Share List" hideCancel>
      <div className="space-y-4 pb-4">
        <section>
          <h3 className="mb-1.5 px-1 text-sm font-medium text-muted-foreground">People on “{list.name}”</h3>
          <ul className="divide-y overflow-hidden rounded-xl bg-card shadow-sm">
            {members.map((m) => (
              <li key={m.userId} className="flex items-center gap-3 px-4 py-2.5">
                <Avatar name={m.name} color={color} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">
                    {m.name}
                    {m.userId === me.id && <span className="text-muted-foreground"> (you)</span>}
                  </div>
                  <div className="text-xs text-muted-foreground">{m.role === "owner" ? "Owner" : "Can edit"}</div>
                </div>
                {isOwner && m.userId !== me.id &&
                  (confirm === m.userId ? (
                    <Button size="sm" variant="destructive" onClick={() => run(() => removeMember(list.id, m.userId))}>
                      Remove
                    </Button>
                  ) : (
                    <button
                      aria-label={`Remove ${m.name}`}
                      className="rounded-full p-1.5 text-muted-foreground active:bg-accent"
                      onClick={() => setConfirm(m.userId)}
                    >
                      <X className="size-4.5" />
                    </button>
                  ))}
              </li>
            ))}
          </ul>
        </section>

        <section className="space-y-2 rounded-xl bg-card p-4 shadow-sm">
          <h3 className="font-medium">Invite with a link</h3>
          <p className="text-sm text-muted-foreground">
            Send this to family. Anyone who opens it can make an account and join this list.
            {link && ` It works until ${new Date(link.expiresAt).toLocaleDateString(undefined, { month: "long", day: "numeric" })}.`}
          </p>
          <input
            readOnly
            value={link?.url ?? "Making a link…"}
            onFocus={(e) => e.currentTarget.select()}
            className="w-full truncate rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground outline-none"
          />
          <div className="flex gap-2">
            {canShare && (
              <Button className="flex-1" disabled={!link} onClick={shareLink} style={{ backgroundColor: color }}>
                <Share /> Share Link
              </Button>
            )}
            <Button variant={canShare ? "secondary" : "default"} className="flex-1" disabled={!link} onClick={copyLink}
              style={canShare ? undefined : { backgroundColor: color }}>
              {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          {isOwner &&
            (confirm === "reset" ? (
              <div className="flex items-center gap-2 pt-1 text-sm">
                <span className="flex-1 text-muted-foreground">The old link stops working. People already on the list stay.</span>
                <Button size="sm" variant="secondary" onClick={() => run(async () => setLink(await getInviteLink(list.id, true)))}>
                  Reset
                </Button>
              </div>
            ) : (
              <button className="flex items-center gap-1.5 pt-1 text-sm text-muted-foreground" onClick={() => setConfirm("reset")}>
                <RotateCcw className="size-3.5" /> Reset link
              </button>
            ))}
        </section>

        {error && <p className="px-1 text-sm text-destructive">{error}</p>}

        {!isOwner &&
          (confirm === "leave" ? (
            <div className="space-y-2 rounded-xl bg-card p-4">
              <p className="text-sm text-muted-foreground">Leave “{list.name}”? You'll need a new invite to come back.</p>
              <div className="flex gap-2">
                <Button variant="secondary" className="flex-1" onClick={() => setConfirm(null)}>Stay</Button>
                <Button
                  variant="destructive"
                  className="flex-1"
                  onClick={() => run(async () => { await removeMember(list.id, me.id); onClose(); navigate({ name: "lists" }, true); })}
                >
                  Leave List
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="ghost" className="w-full text-destructive" onClick={() => setConfirm("leave")}>
              <LogOut /> Leave List
            </Button>
          ))}
      </div>
    </Sheet>
  );
}
