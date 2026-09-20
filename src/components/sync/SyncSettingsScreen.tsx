"use client";

import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { getDb } from "@/lib/db/dexie/db";
import type { SyncCursor } from "@/lib/db/dexie/schema";
import {
  formatBytes,
  getStorageStatus,
  isNearQuotaLimit,
  requestPersistentStorage,
  type StorageStatus,
} from "@/lib/storage/persistence";
import { useSyncStatus } from "@/components/providers/SyncProvider";

export function SyncSettingsScreen() {
  const [storage, setStorage] = useState<StorageStatus | null>(null);
  const { connectivity, lastSyncAt, pendingCount, syncNow, phase } = useSyncStatus();

  const events = useLiveQuery(async () => getDb().syncState.toArray(), [], [] as SyncCursor[]);

  useEffect(() => {
    void getStorageStatus().then(setStorage);
  }, [lastSyncAt]);

  async function handleRequestPersist() {
    await requestPersistentStorage();
    setStorage(await getStorageStatus());
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Sincronização</h1>
        <p className="mt-1 text-sm text-slate-500">
          Status de conectividade: <strong>{connectivity.status === "online" ? "online" : "offline"}</strong>
          {" · "}
          {pendingCount} alteração(ões) pendente(s)
        </p>
        <button
          type="button"
          onClick={() => void syncNow()}
          disabled={phase === "syncing" || connectivity.status !== "online"}
          className="mt-2 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {phase === "syncing" ? "Sincronizando…" : "Sincronizar agora"}
        </button>
      </div>

      <div>
        <h2 className="text-sm font-medium text-slate-700">Eventos preparados neste dispositivo</h2>
        <ul className="mt-2 space-y-1">
          {events.map((e) => (
            <li key={e.key} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
              <span className="font-mono text-xs text-slate-500">{e.key}</span>
              {" — "}
              {e.accessRevokedAt
                ? "acesso retirado — os dados foram removidos deste aparelho"
                : e.lastFullBootstrapAt
                  ? "preparado"
                  : "preparação incompleta"}
              {e.lastSyncAt &&
                ` · última sincronização: ${new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(e.lastSyncAt))}`}
            </li>
          ))}
          {events.length === 0 && <p className="text-sm text-slate-500">Nenhum evento preparado ainda.</p>}
        </ul>
      </div>

      <div>
        <h2 className="text-sm font-medium text-slate-700">Armazenamento local</h2>
        {storage?.supported ? (
          <div className="mt-2 space-y-1 text-sm text-slate-700">
            <p>
              Persistência garantida pelo navegador: <strong>{storage.persisted ? "sim" : "não"}</strong>
            </p>
            {storage.usageBytes != null && storage.quotaBytes != null && (
              <p>
                Uso: {formatBytes(storage.usageBytes)} de {formatBytes(storage.quotaBytes)}
                {isNearQuotaLimit(storage) && (
                  <span className="ml-2 font-medium text-status-error">
                    (perto do limite — libere espaço ou sincronize em breve)
                  </span>
                )}
              </p>
            )}
            {!storage.persisted && (
              <button
                type="button"
                onClick={() => void handleRequestPersist()}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
              >
                Solicitar armazenamento persistente
              </button>
            )}
          </div>
        ) : (
          <p className="mt-1 text-sm text-slate-500">
            Este navegador não expõe informações de quota de armazenamento.
          </p>
        )}
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
        <h2 className="text-sm font-medium text-slate-700">Importante sobre o modo offline</h2>
        <ul className="mt-2 list-disc space-y-1 pl-4">
          <li>O primeiro uso em cada dispositivo exige conexão com a internet.</li>
          <li>
            Dispositivos offline não compartilham alterações entre si até que cada um sincronize
            com o servidor.
          </li>
          <li>
            O navegador pode remover os dados armazenados sob pressão de espaço, mesmo com
            armazenamento persistente solicitado.
          </li>
          <li>
            O suporte offline não é idêntico em todos os navegadores — o Safari no iOS, por
            exemplo, é mais agressivo ao descartar dados do IndexedDB do que Chrome ou Edge.
          </li>
        </ul>
      </div>
    </div>
  );
}
