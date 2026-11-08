import { useEffect, useState, type FormEvent } from "react";
import { ShoppingBasket } from "lucide-react";
import type { AuthInfo, InvitePreview, User } from "../../shared/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { previewInvite, requestPasswordReset, signIn } from "@/lib/store";
import { LIST_COLORS } from "@/lib/colors";
import { ListIcon } from "@/lib/icons";
import { cn } from "@/lib/utils";

type Mode = "login" | "signup" | "forgot";

export function Login({
  info,
  invite,
  onSignedIn,
}: {
  info: AuthInfo;
  invite: string | null;
  onSignedIn: (user: User, listId: string | null) => void;
}) {
  const [mode, setMode] = useState<Mode>(info.firstRun || (invite && info.signupOpen) ? "signup" : "login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<InvitePreview | null>(null);

  // Errors handed back from the Google redirect (?auth_error=…)
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const err = params.get("auth_error");
    if (err) {
      setError(err);
      history.replaceState(null, "", location.pathname + location.hash);
    }
  }, []);

  useEffect(() => {
    if (!invite) return;
    previewInvite(invite)
      .then(setPreview)
      .catch((e: Error) => setError(e.message));
  }, [invite]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === "forgot") {
        await requestPasswordReset(email.trim());
        setNotice("If there's an account for that email, a reset link is on its way. It works for an hour.");
        setMode("login");
      } else {
        const r = await signIn(mode, { email: email.trim(), password, name: name.trim(), invite });
        onSignedIn(r.user, r.listId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't sign in");
    } finally {
      setBusy(false);
    }
  };

  const canSubmit =
    !busy && email.trim() && (mode === "forgot" || (password && (mode === "login" || name.trim())));
  const googleHref = `/api/auth/google${invite ? `?invite=${encodeURIComponent(invite)}` : ""}`;

  return (
    <div className="pt-safe pb-safe flex min-h-dvh items-center justify-center px-6 py-10">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center text-center">
          {preview ? (
            <>
              <div
                className="mb-4 flex size-20 items-center justify-center rounded-full text-white shadow-lg"
                style={{ backgroundColor: LIST_COLORS[preview.color] }}
              >
                <ListIcon name={preview.icon} className="size-10" />
              </div>
              <h1 className="text-2xl font-bold tracking-tight">Join “{preview.listName}”</h1>
              <p className="mt-1 text-muted-foreground">{preview.invitedBy} shared this list with you.</p>
            </>
          ) : (
            <>
              <div className="bg-primary text-primary-foreground mb-4 flex size-20 items-center justify-center rounded-[1.4rem] shadow-lg">
                <ShoppingBasket className="size-10" />
              </div>
              <h1 className="text-3xl font-bold tracking-tight">Grocery Run</h1>
              <p className="mt-1 text-muted-foreground">
                {info.firstRun ? "Create the first account to get started." : "Shared grocery lists"}
              </p>
            </>
          )}
        </div>

        {mode !== "forgot" && (info.signupOpen || mode === "signup") && (
          <div className="flex rounded-lg bg-muted p-1 text-sm font-medium">
            {(["login", "signup"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => { setMode(m); setError(null); }}
                className={cn("flex-1 rounded-md py-2 transition-colors", mode === m ? "bg-card shadow-sm" : "text-muted-foreground")}
              >
                {m === "login" ? "Sign In" : "Create Account"}
              </button>
            ))}
          </div>
        )}

        {info.google && mode !== "forgot" && (
          <>
            <a
              href={googleHref}
              className="flex h-12 w-full items-center justify-center gap-3 rounded-lg border bg-card text-base font-medium shadow-sm active:bg-accent"
            >
              <GoogleMark /> Continue with Google
            </a>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border" /> or with email <span className="h-px flex-1 bg-border" />
            </div>
          </>
        )}

        <form onSubmit={submit} className="space-y-3">
          {mode === "signup" && (
            <Input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          )}
          <Input
            type="email"
            inputMode="email"
            autoCapitalize="off"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete={mode === "signup" ? "email" : "username"}
          />
          {mode !== "forgot" && (
            <Input
              type="password"
              placeholder={mode === "signup" ? "Password (8+ characters)" : "Password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
            />
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          {notice && <p className="text-sm text-muted-foreground">{notice}</p>}
          <Button type="submit" size="lg" className="w-full" disabled={!canSubmit}>
            {busy ? "One moment…" : mode === "signup" ? "Create Account" : mode === "forgot" ? "Send Reset Link" : "Sign In"}
          </Button>
        </form>

        <div className="text-center text-sm text-muted-foreground">
          {mode === "login" &&
            (info.email ? (
              <button className="text-primary" onClick={() => { setMode("forgot"); setError(null); }}>
                Forgot password?
              </button>
            ) : (
              <p>Forgot your password? Whoever runs the server can reset it.</p>
            ))}
          {mode === "forgot" && (
            <button className="text-primary" onClick={() => { setMode("login"); setError(null); }}>
              Back to sign in
            </button>
          )}
          {mode === "login" && !info.signupOpen && (
            <p className="mt-3">New here? Ask someone in the family to share a list with you, then open their link.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="size-5" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.5z" />
    </svg>
  );
}
