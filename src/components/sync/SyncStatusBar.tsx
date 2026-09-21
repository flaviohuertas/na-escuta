"use client";

import { useSyncStatus } from "@/components/providers/SyncProvider";
import { buttonClass } from "@/components/ui/Button";

function formatTime(iso: string | null): string {
  if (!iso) return "nunca";
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(
    new Date(iso)
  );
}

export function SyncStatusBar() {
  const { connectivity, phase, lastError, lastSyncAt, pendingCount, conflictCount, syncNow } =
    useSyncStatus();

  const isOnline = connectivity.status === "online";

  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-white px-4 py-2 text-sm print:hidden md:px-8"
      role="status"
      aria-live="polite"
    >
      <span className="flex items-center gap-1.5 font-medium">
        <span
          aria-hidden="true"
          className={`h-2 w-2 rounded-full ${isOnline ? "bg-status-synced" : "bg-status-offline"}`}
        />
        {isOnline ? "Online" : "Offline"}
      </span>

      {phase === "syncing" && <span className="text-status-syncing">Sincronizando…</span>}

      {pendingCount > 0 && phase !== "syncing" && (
        <span className="text-status-pending">{pendingCount} pendente(s)</span>
      )}

      {conflictCount > 0 && (
        <a href="/conflitos" className="font-medium text-status-conflict underline">
          {conflictCount} conflito(s) para resolver
        </a>
      )}

      {lastError && phase === "error" && (
        <span className="text-status-error">Erro ao sincronizar: {lastError}</span>
      )}

      <span className="text-slate-500">Última sincronização: {formatTime(lastSyncAt)}</span>

      <button
        type="button"
        onClick={() => void syncNow()}
        disabled={phase === "syncing" || !isOnline}
        className={buttonClass({ variant: "secondary", size: "sm", className: "ml-auto max-md:h-11" })}
      >
        Sincronizar agora
      </button>
    </div>
  );
}
