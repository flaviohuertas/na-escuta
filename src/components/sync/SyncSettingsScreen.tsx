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
import { Badge } from "@/components/ui/Badge";
import { buttonClass } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";

const syncTimeFmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function describePending(count: number): string {
  if (count === 0) return "nenhuma alteração pendente";
  return count === 1 ? "1 alteração pendente" : `${count} alterações pendentes`;
}

/**
 * O estado da sincronização neste aparelho. Sincronizar é o botão da barra de cima (está em todas as
 * telas); esta tela não repete o botão.
 */
export function SyncSettingsScreen() {
  const [storage, setStorage] = useState<StorageStatus | null>(null);
  const { connectivity, lastSyncAt, pendingCount } = useSyncStatus();

  const events = useLiveQuery(async () => getDb().syncState.toArray(), [], [] as SyncCursor[]);
  // O nome de cada evento preparado (o registro de sincronização só guarda o id).
  const names = useLiveQuery(
    async () => new Map((await getDb().events.toArray()).map((event) => [event.id, event.name])),
    [],
    new Map<string, string>()
  );

  useEffect(() => {
    void getStorageStatus().then(setStorage);
  }, [lastSyncAt]);

  async function handleRequestPersist() {
    await requestPersistentStorage();
    setStorage(await getStorageStatus());
  }

  return (
    <div className="max-w-2xl space-y-8">
      <PageHeader
        title="Sincronização"
        description={
          <>
            Conexão: <strong>{connectivity.status === "online" ? "online" : "offline"}</strong> · {describePending(pendingCount)}. Para
            sincronizar, use o botão da barra de cima.
          </>
        }
      />

      <section aria-labelledby="prepared">
        <h2 id="prepared" className="text-lg font-semibold text-slate-900">
          Eventos preparados neste aparelho
        </h2>
        {events.length === 0 ? (
          <div className="mt-2">
            <EmptyState hint="Abra um evento na lista de Eventos e toque em Preparar evento para uso offline.">
              Nenhum evento preparado ainda.
            </EmptyState>
          </div>
        ) : (
          <ul className="mt-2 divide-y divide-slate-100 rounded-xl border border-line bg-white text-sm">
            {events.map((e) => (
              <li key={e.key} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span className="min-w-0">
                  <span className="block font-medium text-slate-900">{names.get(e.key) ?? "Evento sem nome neste aparelho"}</span>
                  {e.lastSyncAt && (
                    <span className="block text-xs text-slate-500">Última sincronização: {syncTimeFmt.format(new Date(e.lastSyncAt))}</span>
                  )}
                </span>
                {e.accessRevokedAt ? (
                  <Badge tone="danger">Acesso retirado: dados removidos</Badge>
                ) : e.lastFullBootstrapAt ? (
                  <Badge tone="success">Preparado</Badge>
                ) : (
                  <Badge tone="warning">Preparação incompleta</Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="storage">
        <h2 id="storage" className="text-lg font-semibold text-slate-900">
          Armazenamento local
        </h2>
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
                    Perto do limite: libere espaço ou sincronize em breve.
                  </span>
                )}
              </p>
            )}
            {!storage.persisted && (
              <button
                type="button"
                onClick={() => void handleRequestPersist()}
                className={buttonClass({ variant: "secondary", size: "sm" })}
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
      </section>

      <div className="rounded-xl border border-line bg-slate-50 p-4 text-sm text-slate-700">
        <h2 className="text-base font-semibold text-slate-900">Importante sobre o modo offline</h2>
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
            O suporte offline não é idêntico em todos os navegadores. O Safari no iOS, por
            exemplo, descarta dados do IndexedDB mais cedo do que o Chrome ou o Edge.
          </li>
        </ul>
      </div>
    </div>
  );
}
