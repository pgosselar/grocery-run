import { CloudOff, RefreshCw } from "lucide-react";
import { useStore } from "@/lib/store";

export function SyncBadge() {
  const { online, pending } = useStore();
  if (online && pending === 0) return null;
  return (
    <div className="flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
      {online ? <RefreshCw className="size-3.5 animate-spin" /> : <CloudOff className="size-3.5" />}
      {online ? "Syncing…" : pending ? `Offline · ${pending} to sync` : "Offline"}
    </div>
  );
}
