import type { SyncStatus } from "@/lib/db/dexie/schema";

const LABEL: Record<SyncStatus, string> = {
  offline: "Offline",
  pending: "Pendente",
  syncing: "Sincronizando",
  synced: "Sincronizado",
  conflict: "Conflito",
  error: "Erro",
};

const COLOR: Record<SyncStatus, string> = {
  offline: "bg-slate-100 text-slate-600",
  pending: "bg-amber-100 text-amber-800",
  syncing: "bg-blue-100 text-blue-800",
  synced: "bg-green-100 text-green-800",
  conflict: "bg-red-100 text-red-800",
  error: "bg-red-100 text-red-800",
};

export function SyncStatusBadge({ status }: { status: SyncStatus }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${COLOR[status]}`}>
      {LABEL[status]}
    </span>
  );
}
