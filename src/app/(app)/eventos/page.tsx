import { AppLink } from "@/components/ui/AppLink";
import { requireSession } from "@/lib/auth/require-session";
import { EVENT_ROLE_LABEL } from "@/lib/domain/event-labels";
import { canCreateEvents, canManageEvent, canProposeEventChange } from "@/lib/domain/permissions";
import { getActiveCompanyRole } from "@/server/auth/membership";
import { listAccessibleEvents } from "@/server/events/accessible-events";
import { buttonClass } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge } from "@/components/ui/Badge";
import { cardClass } from "@/components/ui/Card";

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
    <div className="max-w-3xl">
      <PageHeader
        title="Eventos"
        description="Selecione um evento para ver detalhes e prepará-lo para uso offline."
        actions={
          mayCreate && (
            <AppLink href="/eventos/novo" className={buttonClass()}>
              Novo evento
            </AppLink>
          )
        }
      />

      {accessRows.length === 0 ? (
        <div className="mt-6">
          <EmptyState hint={mayCreate ? "Crie o primeiro em Novo evento." : "Quem gerencia um evento dá o acesso na tela Pessoas do evento."}>
            Você ainda não tem acesso a nenhum evento.
          </EmptyState>
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {accessRows.map(({ event, role }) => {
            const mayPropose = canProposeEventChange(role);
            const mayManage = canManageEvent(role);
            return (
              // Um cartão por evento. O nome e as datas são o link; as ações ficam DENTRO do cartão
              // (embaixo no celular, à direita no desktop), para o cartão nunca ser espremido.
              <li key={event.id} className={cardClass({ className: "flex flex-col gap-3 sm:flex-row sm:items-center" })}>
                <AppLink href={`/eventos/${event.id}`} className="-m-2 min-w-0 flex-1 rounded-lg p-2 transition-colors hover:bg-slate-50">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-base text-slate-900">{event.name}</h2>
                    <Badge tone="neutral">{EVENT_ROLE_LABEL[role] ?? role}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">
                    {formatDateRange(event.startDate, event.endDate)}
                    {event.location ? ` · ${event.location}` : ""}
                  </p>
                </AppLink>
                {(mayPropose || mayManage) && (
                  <div className="flex shrink-0 flex-wrap gap-2 border-t border-line pt-3 sm:border-0 sm:pt-0">
                    {mayPropose && (
                      <AppLink
                        href={`/eventos/${event.id}/propor`}
                        aria-label={`Propor alteração em ${event.name}`}
                        className={buttonClass({ variant: "secondary", size: "sm" })}
                      >
                        Propor alteração
                      </AppLink>
                    )}
                    {mayManage && (
                      <>
                        <AppLink href={`/eventos/${event.id}/editar`} aria-label={`Editar ${event.name}`} className={buttonClass({ variant: "secondary", size: "sm" })}>
                          Editar
                        </AppLink>
                        <AppLink href={`/eventos/${event.id}/acessos`} aria-label={`Pessoas de ${event.name}`} className={buttonClass({ variant: "secondary", size: "sm" })}>
                          Pessoas
                        </AppLink>
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
