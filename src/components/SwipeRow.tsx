import { useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface SwipeAction {
  label: string;
  icon: ReactNode;
  className: string;
  onAction: () => void;
}

const ACTION_W = 76;

/**
 * Swipe left to reveal actions (like iOS). A long swipe triggers the last action (usually Delete).
 */
export function SwipeRow({ actions, children }: { actions: SwipeAction[]; children: ReactNode }) {
  const [x, setX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number; base: number; axis: "x" | "y" | null } | null>(null);
  const openW = actions.length * ACTION_W;
  const full = useRef(false);
  const swiped = useRef(false);

  const close = () => setX(0);

  return (
    <div className="relative overflow-hidden">
      {x < 0 && (
      <div className="absolute inset-y-0 right-0 flex" style={{ width: Math.max(openW, -x) }}>
        {actions.map((a, i) => (
          <button
            key={a.label}
            className={cn(
              "flex h-full flex-col items-center justify-center gap-0.5 text-xs font-medium text-white transition-[flex] [&_svg]:size-5",
              a.className,
            )}
            style={{ flex: full.current && i === actions.length - 1 ? 10 : 1 }}
            onClick={() => {
              close();
              a.onAction();
            }}
          >
            {a.icon}
            {a.label}
          </button>
        ))}
      </div>
      )}
      <div
        className={cn("relative bg-card touch-pan-y", dragging ? "select-none" : "transition-transform duration-200")}
        style={{ transform: `translateX(${x}px)` }}
        onPointerDown={(e) => {
          if (e.pointerType === "mouse" && e.button !== 0) return;
          swiped.current = false;
          start.current = { x: e.clientX, y: e.clientY, base: x, axis: null };
        }}
        onPointerMove={(e) => {
          const s = start.current;
          if (!s) return;
          const dx = e.clientX - s.x;
          const dy = e.clientY - s.y;
          if (!s.axis) {
            if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
            s.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
            if (s.axis === "x") {
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              setDragging(true);
            }
          }
          if (s.axis !== "x") return;
          e.preventDefault();
          window.getSelection()?.removeAllRanges();
          const next = Math.min(0, s.base + dx);
          full.current = next < -(openW + 90);
          setX(next);
        }}
        onPointerUp={() => {
          const s = start.current;
          start.current = null;
          if (!s || s.axis !== "x") return;
          swiped.current = true;
          setDragging(false);
          if (full.current) {
            full.current = false;
            setX(0);
            actions[actions.length - 1].onAction();
          } else setX(x < -openW / 2 ? -openW : 0);
        }}
        onPointerCancel={() => {
          start.current = null;
          setDragging(false);
          setX(0);
        }}
        onClickCapture={(e) => {
          // The click that ends a swipe is swallowed; tapping an open row closes it.
          if (swiped.current) {
            swiped.current = false;
            e.stopPropagation();
            e.preventDefault();
          } else if (x !== 0) {
            e.stopPropagation();
            e.preventDefault();
            close();
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}
