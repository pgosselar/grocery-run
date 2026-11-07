import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { cn } from "@/lib/utils";

/** iOS-style bottom sheet with a Cancel / Title / Done header. */
export function Sheet({
  open,
  onOpenChange,
  title,
  onDone,
  doneLabel = "Done",
  doneDisabled,
  hideCancel,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  onDone?: () => void;
  doneLabel?: string;
  doneDisabled?: boolean;
  /** Read-only sheets show just Done */
  hideCancel?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content
          aria-describedby={undefined}
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[92dvh] w-full max-w-lg flex-col rounded-t-2xl bg-background shadow-2xl outline-none",
            "sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2 sm:rounded-2xl",
          )}
        >
          <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-muted-foreground/30 sm:hidden" />
          <div className="flex items-center justify-between px-4 pt-2 pb-3">
            {hideCancel ? (
              <span className="min-w-16" />
            ) : (
              <Dialog.Close className="text-primary min-w-16 text-left text-base">Cancel</Dialog.Close>
            )}
            <Dialog.Title className="text-base font-semibold">{title}</Dialog.Title>
            <button
              className="text-primary min-w-16 text-right text-base font-semibold disabled:opacity-40"
              disabled={doneDisabled}
              onClick={() => (onDone ? onDone() : onOpenChange(false))}
            >
              {doneLabel}
            </button>
          </div>
          <div className="overflow-y-auto px-4 pb-safe">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
