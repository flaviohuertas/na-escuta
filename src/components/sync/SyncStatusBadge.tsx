import { Badge, type BadgeTone } from "@/components/ui/Badge";
import type { SyncStatus } from "@/lib/db/dexie/schema";

const LABEL: Record<SyncStatus, string> = {
  offline: "Offline",
  pending: "Pendente",
  syncing: "Sincronizando",
  synced: "Sincronizado",
  conflict: "Conflito",
  error: "Erro",
};

const TONE: Record<SyncStatus, BadgeTone> = {
  offline: "neutral",
  pending: "warning",
  syncing: "brand",
  synced: "success",
  conflict: "danger",
  error: "danger",
};

export function SyncStatusBadge({ status }: { status: SyncStatus }) {
  return <Badge tone={TONE[status]}>{LABEL[status]}</Badge>;
}
