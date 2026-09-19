"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { getDb } from "@/lib/db/dexie/db";

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
      <h1 className="text-xl font-semibold text-slate-900">Esta tela precisa de internet</h1>
      <p className="mt-2 text-sm text-slate-600">
        Você está sem conexão e esta página não está guardada neste aparelho. Os eventos que você
        preparou antes continuam funcionando normalmente.
      </p>

      <h2 className="mt-6 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Disponíveis offline neste aparelho
      </h2>
      {events === undefined ? (
        <p className="mt-2 text-sm text-slate-500">Carregando…</p>
      ) : events.length === 0 ? (
        <p className="mt-2 text-sm text-slate-600">
          Nenhum evento foi preparado neste aparelho. Quando houver conexão, abra um evento e use
          “Preparar evento para uso offline”.
        </p>
      ) : (
        <ul className="mt-2 space-y-2">
          {events.map((event) => (
            <li key={event.id}>
              <a
                href={`/eventos/${event.id}`}
                className="block rounded-lg border border-slate-200 bg-white p-3 font-medium text-slate-900 hover:border-brand-300"
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
        className="mt-6 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        Tentar novamente
      </button>
    </main>
  );
}
