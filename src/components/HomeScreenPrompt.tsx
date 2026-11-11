import { useEffect, useState, type ReactNode } from "react";
import { Ellipsis, EllipsisVertical, Share, SquarePlus } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import {
  homeScreenPlatform, inAppBrowser, installNow, neverAskHomeScreen, openHomeScreenPrompt, shouldAsk, snoozeHomeScreenPrompt,
  useHomeScreenPrompt,
} from "@/lib/homescreen";
import { showToast } from "@/lib/toast";

/** Ask, a moment after the lists screen opens, if this phone is using the app in a browser tab. */
export function useAskForHomeScreen() {
  useEffect(() => {
    if (!shouldAsk()) return;
    const t = setTimeout(() => shouldAsk() && openHomeScreenPrompt(), 2500);
    return () => clearTimeout(t);
  }, []);
}

const Step = ({ n, children }: { n: number; children: ReactNode }) => (
  <li className="flex gap-3">
    <span className="bg-primary/10 text-primary flex size-6 shrink-0 items-center justify-center rounded-full text-sm font-semibold">{n}</span>
    <span className="pt-0.5">{children}</span>
  </li>
);
const Icon = ({ children }: { children: ReactNode }) => (
  <span className="mx-0.5 inline-flex translate-y-[3px] rounded bg-muted p-0.5 [&_svg]:size-4">{children}</span>
);

export function HomeScreenPrompt() {
  const { open, installable } = useHomeScreenPrompt();
  const [busy, setBusy] = useState(false);
  const platform = homeScreenPlatform();
  if (!platform) return null;

  const install = async () => {
    setBusy(true);
    try {
      if (await installNow()) neverAskHomeScreen();
    } finally {
      setBusy(false);
    }
  };
  const never = () => {
    neverAskHomeScreen();
    showToast("Okay, we won't ask again. It's under Account if you change your mind.");
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && snoozeHomeScreenPrompt()}
      title="Add to Home Screen"
      hideCancel
      doneLabel="Not Now"
      onDone={snoozeHomeScreenPrompt}
    >
      <div className="space-y-5 pb-6">
        <div className="flex items-center gap-4 pt-1">
          <img src="/icon.svg" alt="" className="size-16 shrink-0 rounded-[1.1rem] shadow-md" />
          <p className="text-[15px]">
            Keep <b>Lane Nine</b> on your Home Screen. It opens like an app, full screen, and your lists still work with no signal
            in the store.
          </p>
        </div>

        {inAppBrowser() ? (
          <p className="rounded-xl bg-card p-4 text-sm shadow-sm">
            This page is open inside another app, which can't add it to your Home Screen. Open lanenine.app in{" "}
            {platform === "ios" ? "Safari" : "Chrome"} first, then come back to this.
          </p>
        ) : platform === "ios" ? (
          <ol className="space-y-3 rounded-xl bg-card p-4 text-[15px] shadow-sm">
            <Step n={1}>
              Tap <Icon><Share /></Icon> <b>Share</b> in the toolbar. Don't see it? Tap <Icon><Ellipsis /></Icon> first.
            </Step>
            <Step n={2}>
              Scroll down and tap <Icon><SquarePlus /></Icon> <b>Add to Home Screen</b>.
            </Step>
            <Step n={3}>
              Tap <b>Add</b>, then open Lane Nine from its new icon. You may need to sign in once more there.
            </Step>
          </ol>
        ) : installable ? (
          <Button size="lg" className="w-full" disabled={busy} onClick={install}>
            {busy ? "…" : "Install Lane Nine"}
          </Button>
        ) : (
          <ol className="space-y-3 rounded-xl bg-card p-4 text-[15px] shadow-sm">
            <Step n={1}>
              Tap <Icon><EllipsisVertical /></Icon> in the corner of Chrome.
            </Step>
            <Step n={2}>
              Tap <b>Add to Home screen</b> (or <b>Install app</b>), then <b>Install</b>.
            </Step>
          </ol>
        )}

        <button className="w-full text-center text-sm text-muted-foreground" onClick={never}>
          Don't ask again on this {platform === "ios" && /iPad|Macintosh/.test(navigator.userAgent) ? "iPad" : "phone"}
        </button>
      </div>
    </Sheet>
  );
}
