import { AppLink } from "@/components/ui/AppLink";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { cardClass } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { PageHeader } from "@/components/ui/PageHeader";
import { Stat, type StatTone } from "@/components/ui/Stat";
import {
  APP_TIME_ZONE,
  groupAgendaByDay,
  requiredChecklistProgress,
  taskProgress,
  type AgendaItem,
  type HealthLevel,
  type HealthReason,
  type Portfolio,
  type PortfolioEntry,
} from "@/lib/domain/dashboard";

const dateFmt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: APP_TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});
const timeFmt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: APP_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
});

const ROLE_LABEL: Record<string, string> = {
  MANAGER: "Gestor",
  FIELD_STAFF: "Equipe de campo",
  VIEWER: "Visualização",
};

const HEALTH_LABEL: Record<HealthLevel, string> = {
  OK: "Em dia",
  ATTENTION: "Atenção",
  CRITICAL: "Crítico",
};

const HEALTH_TONE: Record<HealthLevel, BadgeTone> = {
  OK: "success",
  ATTENTION: "warning",
  CRITICAL: "danger",
};

/** Evento de um dia só mostra a data uma vez (no fuso do app, não no do servidor). */
function formatDateRange(start: Date, end: Date): string {
  const from = dateFmt.format(start);
  const to = dateFmt.format(end);
  return from === to ? from : `${from} – ${to}`;
}

function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function describeReason({ code, count }: HealthReason): string {
  switch (code) {
    case "CRITICAL_OCCURRENCES":
      return plural(count, "ocorrência crítica aberta", "ocorrências críticas abertas");
    case "HIGH_OCCURRENCES":
      return plural(count, "ocorrência grave aberta", "ocorrências graves abertas");
    case "OVERDUE_TASKS":
      return plural(count, "tarefa atrasada", "tarefas atrasadas");
    case "BLOCKED_TASKS":
      return plural(count, "tarefa bloqueada", "tarefas bloqueadas");
    case "REQUIRED_CHECKLIST_PENDING":
      return plural(count, "item obrigatório de checklist pendente", "itens obrigatórios de checklist pendentes");
  }
}

function percent(ratio: number | null): string {
  return ratio === null ? "—" : `${Math.round(ratio * 100)}%`;
}

/**
 * Os números do topo. Os dois de contexto ficam sempre; os três de alerta só aparecem quando há o que
 * resolver (e aí em destaque, na cor do alerta). Zerados, viram uma linha só: o maior elemento da tela
 * não pode ser um "0".
 */
function Kpis({ kpis }: { kpis: Portfolio["kpis"] }) {
  const alerts = (
    [
      { label: "Precisam de atenção", value: kpis.eventsNeedingAttention, tone: "warning" },
      { label: "Tarefas atrasadas", value: kpis.tasksOverdue, tone: "warning" },
      { label: "Ocorrências críticas", value: kpis.occurrencesOpenCritical, tone: "danger" },
    ] satisfies Array<{ label: string; value: number; tone: StatTone }>
  ).filter((alert) => alert.value > 0);

  return (
    <dl className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-5">
      <Stat card size="lg" label="Em andamento" value={kpis.ongoingCount} />
      <Stat card size="lg" label="Próximos 30 dias" value={kpis.upcomingSoonCount} />
      {alerts.length === 0 ? (
        // Dentro de um <dl>, o grupo só pode ter <dt> e <dd> (o ícone vai DENTRO do <dt>, senão o axe acusa).
        <div className="col-span-2 rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-emerald-900 md:col-span-3">
          <dt className="flex items-center gap-2 font-semibold">
            <Icon name="check" size={20} />
            Tudo em dia
          </dt>
          <dd className="mt-1 text-sm">Nenhum evento pede atenção, nenhuma tarefa atrasada, nenhuma ocorrência crítica.</dd>
        </div>
      ) : (
        alerts.map((alert) => <Stat key={alert.label} card size="lg" label={alert.label} value={alert.value} tone={alert.tone} />)
      )}
    </dl>
  );
}

function EventCard({ entry }: { entry: PortfolioEntry }) {
  const { event, metrics, health } = entry;
  return (
    <li>
      <AppLink
        href={`/eventos/${event.id}`}
        className={cardClass({ interactive: true, className: "block" })}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold text-slate-900">{event.name}</h3>
          <div className="flex items-center gap-2">
            {health && <Badge tone={HEALTH_TONE[health.level]}>{HEALTH_LABEL[health.level]}</Badge>}
            <Badge tone="neutral">{ROLE_LABEL[entry.role] ?? entry.role}</Badge>
          </div>
        </div>
        <p className="mt-1 text-sm text-slate-500">
          {formatDateRange(event.startDate, event.endDate)}
          {event.location ? ` · ${event.location}` : ""}
        </p>

        <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
          <div>
            <dt className="text-xs text-slate-500">Tarefas</dt>
            <dd className="font-medium text-slate-800">{percent(taskProgress(metrics))}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Checklist obrigatório</dt>
            <dd className="font-medium text-slate-800">{percent(requiredChecklistProgress(metrics))}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Ocorrências abertas</dt>
            <dd className="font-medium text-slate-800">{metrics.occurrencesOpen}</dd>
          </div>
        </dl>

        {health && health.reasons.length > 0 && (
          <ul className="mt-3 list-inside list-disc text-sm text-slate-600">
            {health.reasons.map((reason) => (
              <li key={reason.code}>{describeReason(reason)}</li>
            ))}
          </ul>
        )}
      </AppLink>
    </li>
  );
}

function PortfolioSection({ title, entries }: { title: string; entries: PortfolioEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold text-slate-900">
        {title} <span className="text-sm font-normal text-slate-500">({entries.length})</span>
      </h2>
      <ul className="mt-3 grid gap-3 md:grid-cols-2">
        {entries.map((entry) => (
          <EventCard key={entry.event.id} entry={entry} />
        ))}
      </ul>
    </section>
  );
}

const AGENDA_KIND_LABEL: Record<AgendaItem["kind"], string> = {
  EVENT_START: "Evento",
  EVENT_END: "Evento",
  TASK_DUE: "Tarefa",
};

function AgendaSection({ agenda }: { agenda: AgendaItem[] }) {
  const groups = groupAgendaByDay(agenda);
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold text-slate-900">Agenda dos próximos 14 dias</h2>
      {groups.length === 0 ? (
        <div className="mt-3">
          <EmptyState hint="Início e fim de evento e prazo de tarefa aparecem aqui.">Nada agendado nos próximos 14 dias.</EmptyState>
        </div>
      ) : (
        <div className="mt-3 space-y-4">
          {groups.map((group) => (
            <div key={group.key}>
              <h3
                className={`text-sm font-semibold first-letter:uppercase ${group.overdue ? "text-red-700" : "text-slate-700"}`}
              >
                {group.label}
              </h3>
              <ul className="mt-1 divide-y divide-slate-100 rounded-xl border border-line bg-white">
                {group.items.map((item) => (
                  <li key={item.key}>
                    <AppLink
                      href={`/eventos/${item.eventId}${item.kind === "TASK_DUE" ? "/tarefas" : ""}`}
                      className="flex items-start gap-3 px-3 py-2 hover:bg-slate-50"
                    >
                      <span className="w-24 shrink-0 text-sm tabular-nums text-slate-500">
                        {item.overdue ? dateFmt.format(item.at) : timeFmt.format(item.at)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-slate-900">{item.title}</span>
                        <span className="block truncate text-xs text-slate-500">
                          {AGENDA_KIND_LABEL[item.kind]} · {item.eventName}
                        </span>
                      </span>
                    </AppLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function DashboardView({
  portfolio,
  agenda,
  generatedAt,
}: {
  portfolio: Portfolio;
  agenda: AgendaItem[];
  generatedAt: Date;
}) {
  const { kpis } = portfolio;
  const total =
    portfolio.ongoing.length + portfolio.upcoming.length + portfolio.past.length + portfolio.cancelled.length;

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Painel"
        description={`Visão geral dos seus eventos, calculada no servidor em ${dateFmt.format(generatedAt)} às ${timeFmt.format(generatedAt)}. Sem conexão, esta tela pode mostrar um retrato antigo: para trabalhar offline, abra um evento já preparado.`}
      />

      {total === 0 ? (
        <div className="mt-6">
          <EmptyState hint="Quem gerencia um evento dá o acesso na tela Pessoas do evento.">
            Você ainda não tem acesso a nenhum evento.
          </EmptyState>
        </div>
      ) : (
        <>
          <Kpis kpis={kpis} />

          <AgendaSection agenda={agenda} />

          <PortfolioSection title="Em andamento" entries={portfolio.ongoing} />
          <PortfolioSection title="Próximos" entries={portfolio.upcoming} />
          <PortfolioSection title="Encerrados" entries={portfolio.past} />
          <PortfolioSection title="Cancelados" entries={portfolio.cancelled} />
        </>
      )}
    </div>
  );
}
