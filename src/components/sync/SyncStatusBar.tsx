"use client";

import { useSyncStatus } from "@/components/providers/SyncProvider";
import { buttonClass } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";

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

      {/* No celular, enquanto sincroniza, o horário da última vez é informação velha e, somado a
          "Sincronizando…", faria a barra quebrar em duas linhas (medido no Safari). */}
      <span className={`text-slate-500 ${phase === "syncing" ? "max-sm:hidden" : ""}`}>
        <span className="sm:hidden">Última: </span>
        <span className="max-sm:hidden">Última sincronização: </span>
        {formatTime(lastSyncAt)}
      </span>

      {/* No celular vira só o ícone (44 × 44) para a barra caber numa linha; o nome acessível segue o mesmo. */}
      <button
        type="button"
        onClick={() => void syncNow()}
        disabled={phase === "syncing" || !isOnline}
        className={buttonClass({ variant: "secondary", size: "sm", className: "ml-auto max-sm:size-11 max-sm:px-0" })}
      >
        <Icon name="sincronizacao" size={18} className="sm:hidden" />
        <span className="max-sm:sr-only">Sincronizar agora</span>
      </button>
    </div>
  );
}
