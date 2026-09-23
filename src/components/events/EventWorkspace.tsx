"use client";

import { useEffect, useState } from "react";
import { AppLink } from "@/components/ui/AppLink";
import { useLiveQuery } from "dexie-react-hooks";
import { getDb } from "@/lib/db/dexie/db";
import { PrepareOfflineButton } from "@/components/sync/PrepareOfflineButton";
import { CacheRoutesButton } from "@/components/sync/CacheRoutesButton";
import { areEventRoutesCached } from "@/lib/offline/warm-routes";
import { RevokedEventPanel } from "@/components/events/RevokedEventPanel";
import { Badge } from "@/components/ui/Badge";
import { cardClass } from "@/components/ui/Card";
import { LoadingLine } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";

function formatDateRange(start: string, end: string): string {
  const fmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  return `${fmt.format(new Date(start))} – ${fmt.format(new Date(end))}`;
}

/** O que o servidor diz do evento (nome, datas, local), para a tela antes da preparação. */
export interface EventSummary {
  name: string;
  startDate: string;
  endDate: string;
  location: string | null;
}

function describe(event: { startDate: string; endDate: string; location?: string | null }): string {
  return `${formatDateRange(event.startDate, event.endDate)}${event.location ? ` · ${event.location}` : ""}`;
}

const BACK = { href: "/eventos", label: "Eventos" };

/**
 * Lê tudo do IndexedDB local — nenhuma dependência de servidor. Uma vez
 * preparado, este evento abre e recarrega normalmente sem conexão. `summary` só dá nome à tela
 * enquanto o evento ainda não está no aparelho.
 */
export function EventWorkspace({ eventId, summary = null }: { eventId: string; summary?: EventSummary | null }) {
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
    return <LoadingLine />;
  }

  // Uma única árvore para os dois estados ("ainda não baixado" e "no Dexie"): assim que
  // o download grava o evento, a tela passa do primeiro estado para o segundo; se cada
  // um retornasse uma árvore própria, o React desmontaria o PrepareOfflineButton no meio
  // da preparação e perderia o resultado (sucesso ou divergências) que ele acabou de
  // calcular. Os "slots" abaixo têm posição fixa para o botão manter seu estado.
  const showPrepareButton = !event || !isPrepared;

  return (
    <div className="max-w-3xl">
      {revoked ? null : event ? (
        <PageHeader
          back={BACK}
          title={event.name}
          description={describe(event)}
          actions={
            !isPrepared ? (
              <Badge tone="warning">Preparação incompleta</Badge>
            ) : routesReady === null ? (
              <Badge tone="neutral">Verificando…</Badge>
            ) : routesReady ? (
              <Badge tone="success">Disponível offline</Badge>
            ) : (
              <Badge tone="warning">Telas não guardadas</Badge>
            )
          }
        />
      ) : (
        <div className="max-w-xl">
          <PageHeader
            back={BACK}
            title={summary?.name ?? "Evento ainda não preparado"}
            description={summary ? describe(summary) : undefined}
            actions={summary ? <Badge tone="warning">Não preparado</Badge> : undefined}
          />
          <p className="mt-4 text-sm text-slate-600">
            Para usar este evento neste aparelho, baixe os dados dele agora, enquanto há conexão. Depois
            disso ele abre e funciona sem internet.
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
            navegador, e sem internet o app pode não abrir. Guarde-as agora, enquanto há conexão.
          </p>
          <CacheRoutesButton eventId={eventId} onDone={() => setRecheck((n) => n + 1)} />
        </div>
      )}

      {event && !revoked && (
        <nav aria-label="Áreas do evento" className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            { href: `/eventos/${eventId}/tarefas`, label: "Tarefas" },
            { href: `/eventos/${eventId}/checklists`, label: "Checklists" },
            { href: `/eventos/${eventId}/ocorrencias`, label: "Ocorrências" },
          ].map((area) => (
            <AppLink
              key={area.href}
              href={area.href}
              className={cardClass({ interactive: true, className: "flex min-h-16 items-center justify-center text-center text-lg font-semibold text-slate-900" })}
            >
              {area.label}
            </AppLink>
          ))}
        </nav>
      )}
    </div>
  );
}
