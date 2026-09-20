"use client";

import { useEffect, useState } from "react";
import { AppLink } from "@/components/ui/AppLink";
import { useLiveQuery } from "dexie-react-hooks";
import { getDb } from "@/lib/db/dexie/db";
import { PrepareOfflineButton } from "@/components/sync/PrepareOfflineButton";
import { CacheRoutesButton } from "@/components/sync/CacheRoutesButton";
import { areEventRoutesCached } from "@/lib/offline/warm-routes";
import { RevokedEventPanel } from "@/components/events/RevokedEventPanel";

function formatDateRange(start: string, end: string): string {
  const fmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  return `${fmt.format(new Date(start))} – ${fmt.format(new Date(end))}`;
}

/**
 * Lê tudo do IndexedDB local — nenhuma dependência de servidor. Uma vez
 * preparado, este evento abre e recarrega normalmente sem conexão.
 */
export function EventWorkspace({ eventId }: { eventId: string }) {
  // `useLiveQuery` devolve `undefined` enquanto carrega, mas `events.get()` de um id
  // ausente também resolve `undefined` — sem normalizar para `null`, um evento ainda
  // não preparado ficaria em "Carregando…" para sempre e o botão de preparar nunca
  // apareceria. Aqui: `undefined` = carregando; `null` = consulta concluída, sem registro.
  const event = useLiveQuery(async () => (await getDb().events.get(eventId)) ?? null, [eventId]);
  const isPrepared = useLiveQuery(
    async () => Boolean((await getDb().syncState.get(eventId))?.lastFullBootstrapAt),
    [eventId],
    false
  );

  // O servidor recusou o acesso a este evento (retirado por quem gerencia, vínculo encerrado…) e o
  // aparelho tirou de si o que o servidor guarda. O aviso some se a pessoa preparar o evento de novo
  // depois de recuperar o acesso (o registro de sincronização é regravado sem ele).
  const revoked = useLiveQuery(
    async () => {
      const state = await getDb().syncState.get(eventId);
      return state?.accessRevokedAt ? { reason: state.accessRevokedReason ?? null } : null;
    },
    [eventId],
    null
  );

  // As TELAS (HTML) do evento no cache do navegador — verdade lida do Cache Storage a cada
  // abertura, não um flag nosso: o navegador pode ter limpado o cache, ou o logout pode
  // tê-lo apagado. `null` = ainda checando.
  const [routesReady, setRoutesReady] = useState<boolean | null>(null);
  const [recheck, setRecheck] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void areEventRoutesCached(eventId).then((ready) => {
      if (!cancelled) setRoutesReady(ready);
    });
    return () => {
      cancelled = true;
    };
  }, [eventId, isPrepared, recheck]);

  if (event === undefined) {
    return <p className="text-slate-500">Carregando…</p>;
  }

  // Uma única árvore para os dois estados ("ainda não baixado" e "no Dexie"): assim que
  // o download grava o evento, a tela passa do primeiro estado para o segundo; se cada
  // um retornasse uma árvore própria, o React desmontaria o PrepareOfflineButton no meio
  // da preparação e perderia o resultado (sucesso ou divergências) que ele acabou de
  // calcular. Os "slots" abaixo têm posição fixa para o botão manter seu estado.
  const showPrepareButton = !event || !isPrepared;

  return (
    <div className="mx-auto max-w-3xl">
      {revoked ? null : event ? (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">{event.name}</h1>
            <p className="text-sm text-slate-500">
              {formatDateRange(event.startDate, event.endDate)}
              {event.location ? ` · ${event.location}` : ""}
            </p>
          </div>
          {!isPrepared ? (
            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800">
              Preparação incompleta
            </span>
          ) : routesReady === null ? (
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
              Verificando…
            </span>
          ) : routesReady ? (
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-800">
              Disponível offline
            </span>
          ) : (
            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800">
              Telas não guardadas
            </span>
          )}
        </div>
      ) : (
        <div className="max-w-xl">
          <h1 className="text-xl font-semibold text-slate-900">Evento ainda não preparado</h1>
          <p className="mt-2 text-sm text-slate-600">
            Este evento ainda não foi baixado para uso offline neste dispositivo. Prepare-o agora
            enquanto há conexão — depois disso, ele abre e funciona normalmente sem internet.
          </p>
        </div>
      )}

      {/* Acesso retirado: o aparelho já tirou de si o que o servidor guarda; o painel mostra o que
          sobrou (só existe aqui) e deixa a pessoa exportar ou remover. */}
      {revoked && <RevokedEventPanel eventId={eventId} reason={revoked.reason} />}

      {showPrepareButton && (
        <div className="mt-4">
          <PrepareOfflineButton eventId={eventId} />
        </div>
      )}

      {event && isPrepared && routesReady === false && (
        <div className="mt-4 space-y-2">
          <p className="text-sm text-slate-600">
            Os dados deste evento já estão no aparelho, mas as telas ainda não foram guardadas no
            navegador — sem internet, o app pode não abrir. Guarde-as agora, enquanto há conexão.
          </p>
          <CacheRoutesButton eventId={eventId} onDone={() => setRecheck((n) => n + 1)} />
        </div>
      )}

      {event && !revoked && (
        <nav className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <AppLink
            href={`/eventos/${eventId}/tarefas`}
            className="rounded-lg border border-slate-200 bg-white p-4 text-center font-medium text-slate-800 shadow-sm hover:border-brand-300"
          >
            Tarefas
          </AppLink>
          <AppLink
            href={`/eventos/${eventId}/checklists`}
            className="rounded-lg border border-slate-200 bg-white p-4 text-center font-medium text-slate-800 shadow-sm hover:border-brand-300"
          >
            Checklists
          </AppLink>
          <AppLink
            href={`/eventos/${eventId}/ocorrencias`}
            className="rounded-lg border border-slate-200 bg-white p-4 text-center font-medium text-slate-800 shadow-sm hover:border-brand-300"
          >
            Ocorrências
          </AppLink>
        </nav>
      )}
    </div>
  );
}
