import type { ReactNode } from "react";
import { CircleCheck, CirclePlus } from "lucide-react";
import { formatWhen, timeAgo } from "@/lib/utils";

/** "Added by … / Completed by …" rows, shared by the item ⓘ popover and the history sheet. */
export function Provenance({
  addedBy,
  createdAt,
  completedBy,
  completedAt,
  color,
  compact,
}: {
  addedBy: string;
  createdAt: number;
  completedBy?: string;
  completedAt?: number | null;
  color: string;
  compact?: boolean;
}) {
  return (
    <dl className={compact ? "space-y-1.5" : "space-y-2.5"}>
      <Row
        icon={<CirclePlus className="size-4" />}
        label="Added"
        who={addedBy}
        when={createdAt}
        compact={compact}
        tint="var(--muted-foreground)"
      />
      {completedAt ? (
        <Row
          icon={<CircleCheck className="size-4" />}
          label="Completed"
          who={completedBy ?? ""}
          when={completedAt}
          compact={compact}
          tint={color}
        />
      ) : null}
    </dl>
  );
}

function Row({
  icon,
  label,
  who,
  when,
  compact,
  tint,
}: {
  icon: ReactNode;
  label: string;
  who: string;
  when: number;
  compact?: boolean;
  tint: string;
}) {
  return (
    <div className="flex gap-2.5">
      <span className="mt-0.5 shrink-0" style={{ color: tint }}>
        {icon}
      </span>
      <div className="min-w-0 text-sm leading-snug">
        <dt className="font-medium">
          {label} by {who || <span className="text-muted-foreground italic">unknown</span>}
        </dt>
        <dd className="text-muted-foreground">
          {formatWhen(when)}
          {!compact && <span className="text-muted-foreground/70"> · {timeAgo(when)}</span>}
        </dd>
      </div>
    </div>
  );
}
