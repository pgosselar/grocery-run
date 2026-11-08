import { useEffect, useState } from "react";
import { LogOut } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { signOut, updateAccount, useStore } from "@/lib/store";
import { Avatar } from "./ShareSheet";

export function AccountSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, pending } = useStore();
  const [name, setName] = useState("");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  useEffect(() => {
    if (!open || !user) return;
    setName(user.name);
    setCurrent("");
    setNext("");
    setError(null);
    setNotice(null);
    setConfirmSignOut(false);
  }, [open]);

  if (!user) return null;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      if (name.trim() && name.trim() !== user.name) await updateAccount({ name: name.trim() });
      if (next) {
        await updateAccount({ currentPassword: current, newPassword: next });
        setNotice("Password saved. Your other devices were signed out.");
        setCurrent("");
        setNext("");
        return;
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()} title="Account" onDone={save} doneLabel={busy ? "…" : "Done"} doneDisabled={busy || !name.trim()}>
      <div className="space-y-4 pb-4">
        <div className="flex flex-col items-center gap-2 pt-2">
          <Avatar name={name || user.name} color="var(--primary)" className="size-20 text-2xl" />
          <div className="text-sm text-muted-foreground">{user.email}</div>
        </div>

        <div className="space-y-1.5">
          <label className="px-1 text-sm font-medium text-muted-foreground">Name (what your family sees)</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </div>

        <div className="space-y-1.5">
          <label className="px-1 text-sm font-medium text-muted-foreground">
            {user.hasPassword ? "Change password" : "Add a password"}
          </label>
          {!user.hasPassword && (
            <p className="px-1 text-xs text-muted-foreground">You sign in with Google. A password lets you sign in with your email too.</p>
          )}
          {user.hasPassword && (
            <Input type="password" placeholder="Current password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
          )}
          <Input type="password" placeholder="New password (8+ characters)" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
        </div>

        {user.hasGoogle && <p className="px-1 text-sm text-muted-foreground">Google sign-in is connected.</p>}
        {error && <p className="px-1 text-sm text-destructive">{error}</p>}
        {notice && <p className="px-1 text-sm text-muted-foreground">{notice}</p>}

        {confirmSignOut ? (
          <div className="space-y-2 rounded-xl bg-card p-4">
            <p className="text-sm text-muted-foreground">
              {pending ? `${pending} change${pending === 1 ? " hasn't" : "s haven't"} synced yet and will be lost. ` : ""}
              Sign out on this device?
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setConfirmSignOut(false)}>Cancel</Button>
              <Button variant="destructive" className="flex-1" onClick={() => { onClose(); void signOut(); }}>Sign Out</Button>
            </div>
          </div>
        ) : (
          <Button variant="ghost" className="w-full text-destructive" onClick={() => setConfirmSignOut(true)}>
            <LogOut /> Sign Out
          </Button>
        )}
      </div>
    </Sheet>
  );
}
