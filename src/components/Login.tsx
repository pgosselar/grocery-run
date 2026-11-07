import { useState, type FormEvent } from "react";
import { ShoppingBasket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { login } from "@/lib/store";
import { safeStorage } from "@/lib/utils";

export function Login({ needsPasscode, onDone }: { needsPasscode: boolean; onDone: (name: string) => void }) {
  const [name, setName] = useState(() => safeStorage("gr.name", ""));
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const err = await login(name.trim(), passcode);
      if (err) setError(err);
      else onDone(name.trim());
    } catch {
      setError("Can't reach the server");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pt-safe flex min-h-dvh items-center justify-center px-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center text-center">
          <div className="bg-primary text-primary-foreground mb-4 flex size-20 items-center justify-center rounded-[1.4rem] shadow-lg">
            <ShoppingBasket className="size-10" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Grocery Run</h1>
          <p className="mt-1 text-muted-foreground">The family grocery list</p>
        </div>
        <div className="space-y-3">
          <Input
            autoFocus
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="given-name"
          />
          {needsPasscode && (
            <Input
              type="password"
              placeholder="Family passcode"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              autoComplete="current-password"
            />
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <Button type="submit" size="lg" className="w-full" disabled={busy || !name.trim() || (needsPasscode && !passcode)}>
          {busy ? "Signing in…" : "Continue"}
        </Button>
      </form>
    </div>
  );
}
