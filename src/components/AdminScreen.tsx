import { useEffect, useState, type ReactNode } from "react";
import {
  Check, ChevronDown, ChevronLeft, Copy, KeyRound, Loader2, LogOut, Mail, Share, ShieldCheck, TriangleAlert, UserPlus, X,
} from "lucide-react";
import type { AdminInvite, AdminOverview, AdminUser } from "../../shared/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { adminOverview, createInvite, emailReset, revokeInvite, signOutEverywhere, tempPassword } from "@/lib/admin";
import { goBack } from "@/lib/router";
import { useStore } from "@/lib/store";
import { cn, timeAgo } from "@/lib/utils";
import { Avatar } from "./ShareSheet";

const day = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const shortDay = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: "long", day: "numeric" });
// Sessions record activity to within an hour.
const active = (ms: number | null) => (!ms ? "Never signed in" : Date.now() - ms < 36e5 ? "Active in the last hour" : `Active ${timeAgo(ms)}`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Only the admin sees this: everyone's accounts, invites to the app, and how much it's used. */
export function AdminScreen() {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    adminOverview()
      .then((d) => { setData(d); setError(null); })
      .catch((e: Error) => setError(e.message));
  useEffect(() => { void load(); }, []);

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col">
      <header className="pt-safe sticky top-0 z-10 bg-background/85 px-4 pb-2 backdrop-blur-xl">
        <div className="-ml-2 flex h-10 items-center">
          <button className="text-primary flex items-center text-[17px]" onClick={() => goBack()}>
            <ChevronLeft className="size-7" strokeWidth={2.25} /> Lists
          </button>
        </div>
        <h1 className="text-[34px] leading-tight font-bold tracking-tight">Admin</h1>
      </header>

      <main className="pb-safe space-y-6 px-4 pt-2 pb-10">
        {error && <p className="rounded-xl bg-card p-4 text-sm text-destructive shadow-sm">{error}</p>}
        {!data ? (
          !error && <Loader2 className="mx-auto mt-16 size-8 animate-spin text-muted-foreground" />
        ) : (
          <>
            <Totals data={data} />
            <Invites data={data} reload={load} />
            <People users={data.users} email={data.server.email} />
            <ServerStatus data={data} />
          </>
        )}
      </main>
    </div>
  );
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="mb-1.5 flex items-end justify-between px-1">
        <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

// ---------- totals ----------

function Totals({ data }: { data: AdminOverview }) {
  const t = data.totals;
  const tiles: { label: string; value: number; note?: string }[] = [
    { label: "People", value: t.users, note: `${t.activeWeek} active this week` },
    { label: "Added", value: t.itemsAddedWeek, note: "items this week" },
    { label: "Checked off", value: t.checkedOffWeek, note: "this week" },
    { label: "Lists", value: t.lists, note: `${t.openItems} items to get` },
    { label: "Recipes", value: t.recipes, note: plural(t.photos, "dish photo") },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {tiles.map((x, i) => (
        <div key={x.label} className={cn("rounded-xl bg-card p-3 shadow-sm", i === 0 && "col-span-2 sm:col-span-1")}>
          <div className="text-sm text-muted-foreground">{x.label}</div>
          <div className="text-[28px] leading-tight font-semibold tabular-nums">{x.value}</div>
          {x.note && <div className="text-xs text-muted-foreground">{x.note}</div>}
        </div>
      ))}
    </div>
  );
}

// ---------- invites ----------

function useLinkActions(url: string, title: string) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canShare = typeof navigator.share === "function";
  const share = async () => {
    try {
      await navigator.share({ title, url });
    } catch {
      /* cancelled */
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Couldn't copy. Press and hold the link to copy it.");
    }
  };
  return { canShare, share, copy, copied, error };
}

function Invites({ data, reload }: { data: AdminOverview; reload: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<{ invite: AdminInvite; sent: boolean } | null>(null);
  const [showUsed, setShowUsed] = useState(false);

  const now = Date.now();
  const pending = data.invites.filter((i) => !i.usedBy && i.expiresAt > now);
  const used = data.invites.filter((i) => i.usedBy);
  const expired = data.invites.filter((i) => !i.usedBy && i.expiresAt <= now);

  const make = async (send: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const r = await createInvite({ name: name.trim(), email: email.trim() || undefined, send });
      setMade({ invite: r.invite, sent: send && !r.emailError });
      if (r.emailError) setError(r.emailError);
      setName("");
      setEmail("");
      setOpen(false);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't make the invite");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title="Invites"
      action={
        !open && (
          <button className="text-primary flex items-center gap-1 text-[15px] font-medium" onClick={() => { setOpen(true); setMade(null); setError(null); }}>
            <UserPlus className="size-4.5" /> Invite Someone
          </button>
        )
      }
    >
      <div className="space-y-2">
        {open && (
          <div className="space-y-3 rounded-xl bg-card p-4 shadow-sm">
            <div>
              <h3 className="font-medium">Invite someone to Grocery Run</h3>
              <p className="text-sm text-muted-foreground">
                They get their own account with no lists yet. The link works once, for 14 days. Share a list with them later if you
                like.
              </p>
            </div>
            <Input placeholder="Their name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
            <Input
              type="email"
              placeholder={data.server.email ? "Their email (to send it, or fill in their sign-up)" : "Their email (optional)"}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="off"
              autoCapitalize="none"
            />
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
              {data.server.email && email.trim() ? (
                <>
                  <Button variant="secondary" className="flex-1" disabled={busy || !name.trim()} onClick={() => make(false)}>
                    Just a Link
                  </Button>
                  <Button className="flex-1" disabled={busy || !name.trim()} onClick={() => make(true)}>
                    <Mail /> {busy ? "Sending…" : "Email It"}
                  </Button>
                </>
              ) : (
                <Button className="flex-1" disabled={busy || !name.trim()} onClick={() => make(false)}>
                  {busy ? "Making…" : "Make Link"}
                </Button>
              )}
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}

        {made && <MadeInvite invite={made.invite} sent={made.sent} error={open ? null : error} onClose={() => setMade(null)} />}

        {pending.length > 0 ? (
          <ul className="divide-y overflow-hidden rounded-xl bg-card shadow-sm">
            {pending.map((i) => <PendingInvite key={i.token} invite={i} reload={reload} />)}
          </ul>
        ) : (
          !open && !made && (
            <p className="rounded-xl bg-card px-4 py-3 text-sm text-muted-foreground shadow-sm">
              No open invites. Invite someone to give them their own account without adding them to one of your lists.
            </p>
          )
        )}

        {(used.length > 0 || expired.length > 0) && (
          <>
            <button className="flex items-center gap-1 px-1 text-sm text-muted-foreground" onClick={() => setShowUsed(!showUsed)}>
              <ChevronDown className={cn("size-4 transition-transform", !showUsed && "-rotate-90")} />
              {[used.length && `${used.length} used`, expired.length && `${expired.length} expired`].filter(Boolean).join(", ")}
            </button>
            {showUsed && (
              <ul className="divide-y overflow-hidden rounded-xl bg-card text-sm shadow-sm">
                {[...used, ...expired].map((i) => (
                  <li key={i.token} className="px-4 py-2.5">
                    <div className="font-medium">{i.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {i.usedBy
                        ? `Joined as ${i.usedBy.name} on ${shortDay(i.usedAt!)}`
                        : `Expired ${shortDay(i.expiresAt)}, never used`}
                      {i.email && ` · ${i.email}`}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </Section>
  );
}

function MadeInvite({ invite, sent, error, onClose }: { invite: AdminInvite; sent: boolean; error: string | null; onClose: () => void }) {
  const link = useLinkActions(invite.url, "Join Grocery Run");
  return (
    <div className="space-y-2 rounded-xl bg-card p-4 shadow-sm">
      <div className="flex items-start gap-2">
        <Check className="mt-0.5 size-5 text-green-600" />
        <p className="flex-1 text-sm">
          {sent
            ? `Sent to ${invite.email}. You can also send them the link yourself:`
            : `Here's ${invite.name.split(/\s+/)[0]}'s link. Send it by text or however you like:`}
        </p>
        <button aria-label="Close" className="-m-1 rounded-full p-1 text-muted-foreground" onClick={onClose}>
          <X className="size-4.5" />
        </button>
      </div>
      <input
        readOnly
        value={invite.url}
        onFocus={(e) => e.currentTarget.select()}
        className="w-full truncate rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground outline-none"
      />
      <div className="flex gap-2">
        {link.canShare && <Button className="flex-1" onClick={link.share}><Share /> Share Link</Button>}
        <Button variant={link.canShare ? "secondary" : "default"} className="flex-1" onClick={link.copy}>
          {link.copied ? <Check /> : <Copy />} {link.copied ? "Copied" : "Copy"}
        </Button>
      </div>
      {(error || link.error) && <p className="text-sm text-destructive">{error || link.error}</p>}
    </div>
  );
}

function PendingInvite({ invite, reload }: { invite: AdminInvite; reload: () => Promise<void> }) {
  const link = useLinkActions(invite.url, "Join Grocery Run");
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const revoke = async () => {
    try {
      await revokeInvite(invite.token);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't remove it");
      setConfirm(false);
    }
  };
  return (
    <li className="px-4 py-2.5">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{invite.name}</div>
          <div className="truncate text-xs text-muted-foreground">
            {invite.email ? `${invite.email} · ` : ""}Works until {shortDay(invite.expiresAt)}
          </div>
        </div>
        {confirm ? (
          <>
            <Button size="sm" variant="secondary" onClick={() => setConfirm(false)}>Keep</Button>
            <Button size="sm" variant="destructive" onClick={revoke}>Revoke</Button>
          </>
        ) : (
          <>
            <button
              aria-label={`${link.canShare ? "Share" : "Copy"} ${invite.name}'s link`}
              className="text-primary rounded-full p-2 active:bg-accent"
              onClick={link.canShare ? link.share : link.copy}
            >
              {link.copied ? <Check className="size-5" /> : link.canShare ? <Share className="size-5" /> : <Copy className="size-5" />}
            </button>
            <button aria-label={`Revoke ${invite.name}'s invite`} className="rounded-full p-2 text-muted-foreground active:bg-accent" onClick={() => setConfirm(true)}>
              <X className="size-5" />
            </button>
          </>
        )}
      </div>
      {(error || link.error) && <p className="pt-1 text-sm text-destructive">{error || link.error}</p>}
    </li>
  );
}

// ---------- people ----------

function People({ users, email }: { users: AdminUser[]; email: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  // Most recently active first; people who've never signed in at the end.
  const sorted = [...users].sort((a, b) => (b.lastActive ?? 0) - (a.lastActive ?? 0));
  return (
    <Section title={`People (${users.length})`}>
      <ul className="divide-y overflow-hidden rounded-xl bg-card shadow-sm">
        {sorted.map((u) => (
          <PersonRow key={u.id} user={u} email={email} open={open === u.id} onToggle={() => setOpen(open === u.id ? null : u.id)} />
        ))}
      </ul>
      <p className="px-1 pt-1.5 text-xs text-muted-foreground">Counts only. What's on someone's lists stays between the people on them.</p>
    </Section>
  );
}

function PersonRow({ user: u, email, open, onToggle }: { user: AdminUser; email: boolean; open: boolean; onToggle: () => void }) {
  const me = useStore().user!;
  const isMe = u.id === me.id;
  const stats: [string, string][] = [
    ["Joined", `${day(u.joinedAt)}${u.invitedBy ? `, invited by ${u.invitedBy}` : ""}`],
    ["Signs in with", u.signIn.map((s) => (s === "google" ? "Google" : "password")).join(" and ") || "nothing yet"],
    ["Signed in on", plural(u.devices, "device")],
    ["Lists", `${u.listsOwned} of their own, ${u.listsShared} shared with them`],
    ["Items added", `${u.itemsAdded} (${u.itemsAddedWeek} this week)`],
    ["Checked off", `${u.checkedOff} (${u.checkedOffWeek} this week)`],
    ["Recipes saved", `${u.recipes}${u.photos ? `, ${plural(u.photos, "dish photo")}` : ""}`],
  ];
  return (
    <li>
      <button className="flex w-full items-center gap-3 px-4 py-2.5 text-left active:bg-accent" onClick={onToggle} aria-expanded={open}>
        <Avatar name={u.name} color="var(--primary)" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 truncate font-medium">
            {u.name}
            {isMe && <span className="font-normal text-muted-foreground">(you)</span>}
            {u.admin && <ShieldCheck aria-label="Admin" className="text-primary size-4" />}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {active(u.lastActive)} · {u.itemsAddedWeek} added this week
          </div>
        </div>
        <ChevronDown className={cn("size-5 text-muted-foreground/60 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="space-y-3 px-4 pt-1 pb-4">
          <div className="text-sm text-muted-foreground">{u.email}</div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            {stats.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          {!isMe && <PersonActions user={u} email={email} />}
        </div>
      )}
    </li>
  );
}

function PersonActions({ user: u, email }: { user: AdminUser; email: boolean }) {
  const [confirm, setConfirm] = useState<"temp" | "signout" | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const first = u.name.split(/\s+/)[0];

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work");
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  if (password) {
    return (
      <div className="space-y-2 rounded-lg bg-muted p-3">
        <p className="text-sm">
          {first}'s temporary password. Give it to them; they're signed out until they use it, and can change it under Account.
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 rounded-md bg-background px-3 py-2 font-mono text-lg tracking-wide select-all">{password}</code>
          <Button
            variant="secondary"
            onClick={() => navigator.clipboard?.writeText(password).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }, () => {})}
          >
            {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <button className="text-primary text-sm" onClick={() => setPassword(null)}>Done</button>
      </div>
    );
  }

  if (confirm) {
    const text =
      confirm === "temp"
        ? `This replaces ${first}'s password and signs them out everywhere. Use it when they can't sign in.`
        : `Sign ${first} out on every phone and computer? They'll need to sign in again.`;
    return (
      <div className="space-y-2 rounded-lg bg-muted p-3">
        <p className="text-sm">{text}</p>
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={() => setConfirm(null)}>Cancel</Button>
          <Button
            variant="destructive"
            className="flex-1"
            disabled={busy}
            onClick={() =>
              confirm === "temp"
                ? run(async () => setPassword((await tempPassword(u.id)).password))
                : run(async () => { await signOutEverywhere(u.id); setNotice(`${first} is signed out everywhere.`); })
            }
          >
            {confirm === "temp" ? "Make Password" : "Sign Out"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {email && (
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => run(async () => { await emailReset(u.id); setNotice(`Sent ${first} a link to choose a new password. It works for an hour.`); })}
          >
            <Mail /> Email Reset Link
          </Button>
        )}
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => setConfirm("temp")}>
          <KeyRound /> Temporary Password
        </Button>
        {u.devices > 0 && (
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => setConfirm("signout")}>
            <LogOut /> Sign Out Everywhere
          </Button>
        )}
      </div>
      {notice && <p className="text-sm text-muted-foreground">{notice}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

// ---------- server ----------

function ServerStatus({ data }: { data: AdminOverview }) {
  const { backups, dbBytes, email } = data.server;
  const mb = dbBytes / 1024 / 1024;
  const rows: [string, ReactNode][] = [
    [
      "Backups",
      backups.ok ? (
        <>
          Last one {backups.lastBackup ? timeAgo(Date.parse(backups.lastBackup)) : "never"}
          {backups.mirror ? ", copied to the NAS" : ", on this machine only"}
        </>
      ) : (
        <span className="text-destructive">
          <TriangleAlert className="mr-1 inline size-4 align-[-3px]" />
          {backups.problems.join("; ")}
        </span>
      ),
    ],
    ["Database", mb < 1 ? `${Math.max(1, Math.round(dbBytes / 1024))} KB` : `${mb.toFixed(1)} MB`],
    ["Email", email ? "Set up (invites and password resets)" : "Not set up"],
  ];
  return (
    <Section title="Server">
      <dl className="divide-y overflow-hidden rounded-xl bg-card text-sm shadow-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-4 px-4 py-2.5">
            <dt className="w-20 shrink-0 text-muted-foreground">{k}</dt>
            <dd className="min-w-0 flex-1">{v}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}
