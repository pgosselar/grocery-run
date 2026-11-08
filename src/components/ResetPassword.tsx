import { useState, type FormEvent } from "react";
import { KeyRound } from "lucide-react";
import type { User } from "../../shared/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { resetPassword } from "@/lib/store";
import { navigate } from "@/lib/router";

export function ResetPassword({ token, onDone }: { token: string; onDone: (u: User) => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onDone((await resetPassword(token, password)).user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't reset the password");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pt-safe flex min-h-dvh items-center justify-center px-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center text-center">
          <div className="bg-primary text-primary-foreground mb-4 flex size-20 items-center justify-center rounded-[1.4rem] shadow-lg">
            <KeyRound className="size-10" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Choose a new password</h1>
          <p className="mt-1 text-muted-foreground">This signs you out on your other devices.</p>
        </div>
        <Input
          autoFocus
          type="password"
          placeholder="New password (8+ characters)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" size="lg" className="w-full" disabled={busy || password.length < 8}>
          {busy ? "Saving…" : "Save Password"}
        </Button>
        <button type="button" className="text-primary w-full text-sm" onClick={() => navigate({ name: "lists" }, true)}>
          Cancel
        </button>
      </form>
    </div>
  );
}
