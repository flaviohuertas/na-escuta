import { AppLink } from "@/components/ui/AppLink";
import { requireSession } from "@/lib/auth/require-session";
import { EVENT_ROLE_LABEL } from "@/lib/domain/event-labels";
import { canCreateEvents, canManageEvent } from "@/lib/domain/permissions";
import { getActiveCompanyRole } from "@/server/auth/membership";
import { listAccessibleEvents } from "@/server/events/accessible-events";

function formatDateRange(start: Date, end: Date): string {
  const fmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  return `${fmt.format(start)} – ${fmt.format(end)}`;
}

/**
 * Catálogo de eventos acessíveis — busca ao vivo no servidor (exige conexão
 * na primeira vez, como documentado). Depois de "preparado", cada evento
 * passa a abrir e funcionar via IndexedDB, sem depender mais desta página.
 */
export default async function EventsPage() {
  const session = await requireSession();
  const userId = session.user.id;

  const [accessRows, companyRole] = await Promise.all([
    listAccessibleEvents(userId),
    getActiveCompanyRole(userId, session.user.companyId),
  ]);
  const mayCreate = companyRole !== null && canCreateEvents(companyRole);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Eventos</h1>
          <p className="mt-1 text-sm text-slate-500">
            Selecione um evento para ver detalhes e prepará-lo para uso offline.
          </p>
        </div>
        {mayCreate && (
          <AppLink
            href="/eventos/novo"
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            Novo evento
          </AppLink>
        )}
      </div>

      {accessRows.length === 0 ? (
        <p className="mt-6 text-slate-500">
          Você ainda não tem acesso a nenhum evento.
          {mayCreate ? " Crie o primeiro." : ""}
        </p>
      ) : (
        <ul className="mt-6 space-y-3">
          {accessRows.map(({ event, role }) => (
            <li key={event.id} className="flex items-center gap-2">
              <AppLink
                href={`/eventos/${event.id}`}
                className="block min-w-0 flex-1 rounded-lg border border-slate-200 bg-white p-4 shadow-sm hover:border-brand-300 hover:shadow"
              >
                <div className="flex items-center justify-between gap-2">
                  <h2 className="font-medium text-slate-900">{event.name}</h2>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                    {EVENT_ROLE_LABEL[role] ?? role}
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  {formatDateRange(event.startDate, event.endDate)}
                  {event.location ? ` · ${event.location}` : ""}
                </p>
              </AppLink>
              {canManageEvent(role) && (
                <div className="flex shrink-0 flex-col gap-1 sm:flex-row">
                  <AppLink
                    href={`/eventos/${event.id}/editar`}
                    aria-label={`Editar ${event.name}`}
                    className="rounded-md border border-slate-300 bg-white px-3 py-2 text-center text-sm text-slate-700 hover:bg-slate-50"
                  >
                    Editar
                  </AppLink>
                  <AppLink
                    href={`/eventos/${event.id}/acessos`}
                    aria-label={`Pessoas de ${event.name}`}
                    className="rounded-md border border-slate-300 bg-white px-3 py-2 text-center text-sm text-slate-700 hover:bg-slate-50"
                  >
                    Pessoas
                  </AppLink>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
