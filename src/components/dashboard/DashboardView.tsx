import { AppLink } from "@/components/ui/AppLink";
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

const HEALTH_STYLE: Record<HealthLevel, string> = {
  OK: "bg-emerald-100 text-emerald-800",
  ATTENTION: "bg-amber-100 text-amber-800",
  CRITICAL: "bg-red-100 text-red-800",
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

function KpiCard({ label, value, tone = "neutral" }: { label: string; value: number; tone?: "neutral" | "warn" | "danger" }) {
  const valueColor =
    tone === "danger" && value > 0 ? "text-red-700" : tone === "warn" && value > 0 ? "text-amber-700" : "text-slate-900";
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-3xl font-semibold ${valueColor}`}>{value}</p>
    </div>
  );
}

function EventCard({ entry }: { entry: PortfolioEntry }) {
  const { event, metrics, health } = entry;
  return (
    <li>
      <AppLink
        href={`/eventos/${event.id}`}
        className="block rounded-lg border border-slate-200 bg-white p-4 shadow-sm hover:border-brand-300 hover:shadow"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-medium text-slate-900">{event.name}</h3>
          <div className="flex items-center gap-2">
            {health && (
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${HEALTH_STYLE[health.level]}`}>
                {HEALTH_LABEL[health.level]}
              </span>
            )}
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
              {ROLE_LABEL[entry.role] ?? entry.role}
            </span>
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
      <h2 className="text-lg font-semibold text-slate-900">Agenda — próximos 14 dias</h2>
      {groups.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">Nada agendado nos próximos 14 dias.</p>
      ) : (
        <div className="mt-3 space-y-4">
          {groups.map((group) => (
            <div key={group.key}>
              <h3
                className={`text-sm font-semibold first-letter:uppercase ${group.overdue ? "text-red-700" : "text-slate-700"}`}
              >
                {group.label}
              </h3>
              <ul className="mt-1 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
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
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-semibold text-slate-900">Painel</h1>
      <p className="mt-1 text-sm text-slate-500">
        Visão geral dos seus eventos, calculada no servidor em {dateFmt.format(generatedAt)} às{" "}
        {timeFmt.format(generatedAt)}. Sem conexão, esta tela pode mostrar um retrato antigo — para
        trabalhar offline, abra um evento já preparado.
      </p>

      {total === 0 ? (
        <p className="mt-6 text-slate-500">Você ainda não tem acesso a nenhum evento.</p>
      ) : (
        <>
          <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-5">
            <KpiCard label="Em andamento" value={kpis.ongoingCount} />
            <KpiCard label="Próximos 30 dias" value={kpis.upcomingSoonCount} />
            <KpiCard label="Precisam de atenção" value={kpis.eventsNeedingAttention} tone="warn" />
            <KpiCard label="Tarefas atrasadas" value={kpis.tasksOverdue} tone="warn" />
            <KpiCard label="Ocorrências críticas" value={kpis.occurrencesOpenCritical} tone="danger" />
          </div>

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
