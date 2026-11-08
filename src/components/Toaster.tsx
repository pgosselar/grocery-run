import { dismissToast, useToast } from "@/lib/toast";

/** Shows the current toast above the bottom edge of the screen. */
export function Toaster() {
  const toast = useToast();
  if (!toast) return null;
  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-[60] flex justify-center px-4"
      style={{ bottom: "max(env(safe-area-inset-bottom), 1rem)" }}
    >
      <div
        key={toast.id}
        role="status"
        className="animate-toast pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl bg-foreground py-3 pr-2 pl-4 text-[15px] text-background shadow-xl"
      >
        <span className="min-w-0 flex-1">{toast.message}</span>
        {toast.action && (
          <button
            className="shrink-0 rounded-full px-3 py-1.5 font-semibold text-background/80 active:bg-background/15"
            onClick={() => {
              toast.action!.run();
              dismissToast();
            }}
          >
            {toast.action.label}
          </button>
        )}
      </div>
    </div>
  );
}
