"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { getDb } from "@/lib/db/dexie/db";
import { buttonClass } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState, LoadingLine } from "@/components/ui/EmptyState";

/**
 * Tela mostrada pelo Service Worker quando não há rede e a página pedida não está guardada
 * (`/painel`, `/conflitos`, `/eventos`… — leem o Postgres ao vivo). Em vez do erro do
 * navegador, diz o que aconteceu e leva aos eventos que JÁ funcionam offline neste aparelho.
 *
 * É pré-carregada pelo SW na instalação, então é pública e não sabe nada de sessão: a lista vem
 * do IndexedDB, no próprio aparelho. Usa `<a>` comum (navegação de documento): não há
 * `SyncProvider` aqui, e o SW serve a tela do evento a partir do cache.
 */
export function OfflineFallback() {
  // `undefined` = ainda lendo o IndexedDB.
  const events = useLiveQuery(async () => {
    const db = getDb();
    const prepared = (await db.syncState.toArray()).filter((s) => s.lastFullBootstrapAt);
    const rows = await db.events.bulkGet(prepared.map((s) => s.key));
    return rows
      .filter((e): e is NonNullable<typeof e> => Boolean(e) && !e?.deletedAt)
      .sort((a, b) => a.startDate.localeCompare(b.startDate));
  }, []);

  return (
    <main className="mx-auto max-w-xl p-6">
      <PageHeader
        title="Esta tela precisa de internet"
        description="Você está sem conexão e esta página não está guardada neste aparelho. Os eventos que você preparou antes continuam funcionando normalmente."
      />

      <h2 className="mt-6 text-lg font-semibold text-slate-900">Disponíveis offline neste aparelho</h2>
      {events === undefined ? (
        <div className="mt-2">
          <LoadingLine />
        </div>
      ) : events.length === 0 ? (
        <div className="mt-2">
          <EmptyState hint="Quando houver conexão, abra um evento e use “Preparar evento para uso offline”.">
            Nenhum evento foi preparado neste aparelho.
          </EmptyState>
        </div>
      ) : (
        <ul className="mt-2 space-y-2">
          {events.map((event) => (
            <li key={event.id}>
              <a
                href={`/eventos/${event.id}`}
                className="block rounded-xl border border-line bg-white p-4 font-semibold text-slate-900 transition-colors hover:border-brand-300"
              >
                {event.name}
              </a>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={() => window.location.reload()}
        className={buttonClass({ variant: "secondary", className: "mt-6" })}
      >
        Tentar novamente
      </button>
    </main>
  );
}
