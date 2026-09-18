"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { getDb } from "@/lib/db/dexie/db";
import { PrepareOfflineButton } from "@/components/sync/PrepareOfflineButton";

function formatDateRange(start: string, end: string): string {
  const fmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  return `${fmt.format(new Date(start))} – ${fmt.format(new Date(end))}`;
}

/**
 * Lê tudo do IndexedDB local — nenhuma dependência de servidor. Uma vez
 * preparado, este evento abre e recarrega normalmente sem conexão.
 */
export function EventWorkspace({ eventId }: { eventId: string }) {
  const event = useLiveQuery(() => getDb().events.get(eventId), [eventId]);
  const isPrepared = useLiveQuery(
    async () => Boolean((await getDb().syncState.get(eventId))?.lastFullBootstrapAt),
    [eventId],
    false
  );

  if (event === undefined) {
    return <p className="text-slate-500">Carregando…</p>;
  }

  if (!event) {
    return (
      <div className="mx-auto max-w-xl">
        <h1 className="text-xl font-semibold text-slate-900">Evento ainda não preparado</h1>
        <p className="mt-2 text-sm text-slate-600">
          Este evento ainda não foi baixado para uso offline neste dispositivo. Prepare-o agora
          enquanto há conexão — depois disso, ele abre e funciona normalmente sem internet.
        </p>
        <div className="mt-4">
          <PrepareOfflineButton eventId={eventId} />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{event.name}</h1>
          <p className="text-sm text-slate-500">
            {formatDateRange(event.startDate, event.endDate)}
            {event.location ? ` · ${event.location}` : ""}
          </p>
        </div>
        {!isPrepared && (
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800">
            Preparação incompleta
          </span>
        )}
      </div>

      {!isPrepared && (
        <div className="mt-3">
          <PrepareOfflineButton eventId={eventId} />
        </div>
      )}

      <nav className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Link
          href={`/eventos/${eventId}/tarefas`}
          className="rounded-lg border border-slate-200 bg-white p-4 text-center font-medium text-slate-800 shadow-sm hover:border-brand-300"
        >
          Tarefas
        </Link>
        <Link
          href={`/eventos/${eventId}/checklists`}
          className="rounded-lg border border-slate-200 bg-white p-4 text-center font-medium text-slate-800 shadow-sm hover:border-brand-300"
        >
          Checklists
        </Link>
        <Link
          href={`/eventos/${eventId}/ocorrencias`}
          className="rounded-lg border border-slate-200 bg-white p-4 text-center font-medium text-slate-800 shadow-sm hover:border-brand-300"
        >
          Ocorrências
        </Link>
      </nav>
    </div>
  );
}
