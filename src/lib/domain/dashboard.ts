import type { EventStatus } from "./event.schema";
import type { OccurrenceSeverity } from "./occurrence.schema";
import type { TaskStatus } from "./task.schema";
import type { ChecklistItemStatus } from "./checklist.schema";

/**
 * Lógica pura do Painel gerencial (módulo 1): fase do evento, saúde, agenda e
 * portfólio. Sem I/O — recebe dados já carregados e devolve estruturas prontas
 * para a UI, o que permite testar as regras sem banco.
 *
 * Fuso: datas de agenda são agrupadas por dia em America/Sao_Paulo (público-alvo
 * do produto), e não no fuso do servidor, para que um evento às 22h não caia no
 * dia seguinte quando o servidor roda em UTC.
 */
export const APP_TIME_ZONE = "America/Sao_Paulo";

export const DEFAULT_AGENDA_HORIZON_DAYS = 14;
/** Janela em que faltar item obrigatório de checklist já conta como "atenção". */
export const CHECKLIST_ALERT_WINDOW_HOURS = 48;
export const UPCOMING_KPI_WINDOW_DAYS = 30;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// ---------------------------------------------------------------------------
// Fase do evento
// ---------------------------------------------------------------------------

export type EventPhase = "ONGOING" | "UPCOMING" | "PAST" | "CANCELLED";

export interface DashboardEvent {
  id: string;
  name: string;
  location: string | null;
  startDate: Date;
  endDate: Date;
  status: EventStatus;
}

/**
 * As datas são a fonte de verdade para "quando"; o status só sobrepõe nos
 * estados terminais (CANCELLED/COMPLETED) — um evento marcado COMPLETED cujo
 * fim ainda não chegou é tratado como encerrado, porque alguém o encerrou de
 * propósito.
 */
export function classifyEventPhase(event: DashboardEvent, now: Date): EventPhase {
  if (event.status === "CANCELLED") return "CANCELLED";
  if (event.status === "COMPLETED") return "PAST";
  if (now < event.startDate) return "UPCOMING";
  if (now <= event.endDate) return "ONGOING";
  return "PAST";
}

export function isActivePhase(phase: EventPhase): boolean {
  return phase === "ONGOING" || phase === "UPCOMING";
}

// ---------------------------------------------------------------------------
// Métricas por evento (montadas a partir de contagens agregadas do banco)
// ---------------------------------------------------------------------------

export interface EventMetrics {
  tasksOpen: number;
  tasksDone: number;
  tasksBlocked: number;
  tasksOverdue: number;
  occurrencesOpen: number;
  /** HIGH + CRITICAL ainda abertas (inclui as críticas). */
  occurrencesOpenHigh: number;
  occurrencesOpenCritical: number;
  /** Itens obrigatórios de checklist ainda pendentes / já concluídos (N/A não conta). */
  requiredItemsPending: number;
  requiredItemsDone: number;
}

export function emptyMetrics(): EventMetrics {
  return {
    tasksOpen: 0,
    tasksDone: 0,
    tasksBlocked: 0,
    tasksOverdue: 0,
    occurrencesOpen: 0,
    occurrencesOpenHigh: 0,
    occurrencesOpenCritical: 0,
    requiredItemsPending: 0,
    requiredItemsDone: 0,
  };
}

export interface MetricsSourceRows {
  /** Tarefas não excluídas, contadas por status. */
  taskCounts: { eventId: string; status: TaskStatus; count: number }[];
  /** Tarefas não concluídas com prazo vencido. */
  overdueTaskCounts: { eventId: string; count: number }[];
  /** Ocorrências ABERTAS (OPEN/IN_PROGRESS) por severidade. */
  openOccurrenceCounts: { eventId: string; severity: OccurrenceSeverity; count: number }[];
  /** Itens obrigatórios de checklist, por status. */
  requiredItemCounts: { eventId: string; status: ChecklistItemStatus; count: number }[];
}

/**
 * Converte as linhas do `groupBy` em uma métrica por evento. Todo `eventId` em
 * `eventIds` aparece no resultado (com zeros) — eventos sem tarefas/ocorrências
 * não somem do portfólio.
 */
export function buildMetricsByEvent(
  eventIds: string[],
  rows: MetricsSourceRows
): Map<string, EventMetrics> {
  const byEvent = new Map<string, EventMetrics>();
  for (const id of eventIds) byEvent.set(id, emptyMetrics());

  for (const row of rows.taskCounts) {
    const m = byEvent.get(row.eventId);
    if (!m) continue;
    if (row.status === "DONE") m.tasksDone += row.count;
    else m.tasksOpen += row.count;
    if (row.status === "BLOCKED") m.tasksBlocked += row.count;
  }
  for (const row of rows.overdueTaskCounts) {
    const m = byEvent.get(row.eventId);
    if (m) m.tasksOverdue += row.count;
  }
  for (const row of rows.openOccurrenceCounts) {
    const m = byEvent.get(row.eventId);
    if (!m) continue;
    m.occurrencesOpen += row.count;
    if (row.severity === "HIGH" || row.severity === "CRITICAL") m.occurrencesOpenHigh += row.count;
    if (row.severity === "CRITICAL") m.occurrencesOpenCritical += row.count;
  }
  for (const row of rows.requiredItemCounts) {
    const m = byEvent.get(row.eventId);
    if (!m) continue;
    if (row.status === "PENDING") m.requiredItemsPending += row.count;
    else if (row.status === "DONE") m.requiredItemsDone += row.count;
  }
  return byEvent;
}

/** Progresso das tarefas em [0,1]; null quando o evento não tem tarefa nenhuma. */
export function taskProgress(m: EventMetrics): number | null {
  const total = m.tasksOpen + m.tasksDone;
  return total === 0 ? null : m.tasksDone / total;
}

/** Progresso dos itens obrigatórios de checklist em [0,1]; null quando não há nenhum. */
export function requiredChecklistProgress(m: EventMetrics): number | null {
  const total = m.requiredItemsPending + m.requiredItemsDone;
  return total === 0 ? null : m.requiredItemsDone / total;
}

// ---------------------------------------------------------------------------
// Saúde do evento
// ---------------------------------------------------------------------------

export type HealthLevel = "OK" | "ATTENTION" | "CRITICAL";

export type HealthReasonCode =
  | "CRITICAL_OCCURRENCES"
  | "HIGH_OCCURRENCES"
  | "OVERDUE_TASKS"
  | "BLOCKED_TASKS"
  | "REQUIRED_CHECKLIST_PENDING";

export interface HealthReason {
  code: HealthReasonCode;
  count: number;
}

export interface EventHealth {
  level: HealthLevel;
  reasons: HealthReason[];
}

/**
 * Semáforo do evento. Só faz sentido para eventos ativos (em andamento ou
 * futuros) — para encerrados/cancelados devolve `null` em vez de fingir um
 * "OK" que ninguém está acompanhando.
 *
 * - CRITICAL: existe ocorrência CRITICAL aberta.
 * - ATTENTION: tarefa atrasada, tarefa bloqueada, ocorrência HIGH aberta, ou
 *   item obrigatório de checklist pendente com o evento em andamento / a
 *   menos de 48h de começar (antes disso ainda há tempo de fechar o checklist).
 */
export function computeEventHealth(
  event: DashboardEvent,
  metrics: EventMetrics,
  now: Date
): EventHealth | null {
  const phase = classifyEventPhase(event, now);
  if (!isActivePhase(phase)) return null;

  const reasons: HealthReason[] = [];
  if (metrics.occurrencesOpenCritical > 0) {
    reasons.push({ code: "CRITICAL_OCCURRENCES", count: metrics.occurrencesOpenCritical });
  }
  const highNonCritical = metrics.occurrencesOpenHigh - metrics.occurrencesOpenCritical;
  if (highNonCritical > 0) reasons.push({ code: "HIGH_OCCURRENCES", count: highNonCritical });
  if (metrics.tasksOverdue > 0) reasons.push({ code: "OVERDUE_TASKS", count: metrics.tasksOverdue });
  if (metrics.tasksBlocked > 0) reasons.push({ code: "BLOCKED_TASKS", count: metrics.tasksBlocked });

  const startsSoon = event.startDate.getTime() - now.getTime() <= CHECKLIST_ALERT_WINDOW_HOURS * HOUR_MS;
  if (metrics.requiredItemsPending > 0 && (phase === "ONGOING" || startsSoon)) {
    reasons.push({ code: "REQUIRED_CHECKLIST_PENDING", count: metrics.requiredItemsPending });
  }

  const level: HealthLevel = metrics.occurrencesOpenCritical > 0
    ? "CRITICAL"
    : reasons.length > 0
      ? "ATTENTION"
      : "OK";
  return { level, reasons };
}

// ---------------------------------------------------------------------------
// Portfólio
// ---------------------------------------------------------------------------

export interface PortfolioEntry {
  event: DashboardEvent;
  /** Papel do usuário logado neste evento (para exibir na listagem). */
  role: string;
  phase: EventPhase;
  metrics: EventMetrics;
  health: EventHealth | null;
}

export interface PortfolioKpis {
  ongoingCount: number;
  /** Eventos que começam dentro de UPCOMING_KPI_WINDOW_DAYS. */
  upcomingSoonCount: number;
  /** Somente eventos ativos: atrasos e ocorrências de eventos encerrados não entram. */
  tasksOverdue: number;
  occurrencesOpenCritical: number;
  eventsNeedingAttention: number;
}

export interface Portfolio {
  ongoing: PortfolioEntry[];
  upcoming: PortfolioEntry[];
  past: PortfolioEntry[];
  cancelled: PortfolioEntry[];
  kpis: PortfolioKpis;
}

export interface PortfolioInput {
  event: DashboardEvent;
  role: string;
  metrics: EventMetrics;
}

export function buildPortfolio(inputs: PortfolioInput[], now: Date): Portfolio {
  const entries: PortfolioEntry[] = inputs.map(({ event, role, metrics }) => ({
    event,
    role,
    phase: classifyEventPhase(event, now),
    metrics,
    health: computeEventHealth(event, metrics, now),
  }));

  const byPhase = (phase: EventPhase) => entries.filter((e) => e.phase === phase);
  const time = (d: Date) => d.getTime();
  const tie = (a: PortfolioEntry, b: PortfolioEntry) => a.event.id.localeCompare(b.event.id);

  const ongoing = byPhase("ONGOING").sort(
    (a, b) => time(a.event.endDate) - time(b.event.endDate) || tie(a, b)
  );
  const upcoming = byPhase("UPCOMING").sort(
    (a, b) => time(a.event.startDate) - time(b.event.startDate) || tie(a, b)
  );
  const past = byPhase("PAST").sort(
    (a, b) => time(b.event.endDate) - time(a.event.endDate) || tie(a, b)
  );
  const cancelled = byPhase("CANCELLED").sort(
    (a, b) => time(b.event.startDate) - time(a.event.startDate) || tie(a, b)
  );

  const active = [...ongoing, ...upcoming];
  const soonLimit = now.getTime() + UPCOMING_KPI_WINDOW_DAYS * DAY_MS;

  return {
    ongoing,
    upcoming,
    past,
    cancelled,
    kpis: {
      ongoingCount: ongoing.length,
      upcomingSoonCount: upcoming.filter((e) => time(e.event.startDate) <= soonLimit).length,
      tasksOverdue: active.reduce((sum, e) => sum + e.metrics.tasksOverdue, 0),
      occurrencesOpenCritical: active.reduce((sum, e) => sum + e.metrics.occurrencesOpenCritical, 0),
      eventsNeedingAttention: active.filter((e) => e.health && e.health.level !== "OK").length,
    },
  };
}

// ---------------------------------------------------------------------------
// Agenda
// ---------------------------------------------------------------------------

export type AgendaItemKind = "EVENT_START" | "EVENT_END" | "TASK_DUE";

export interface AgendaItem {
  /** Estável entre renders — serve de `key` no React e de desempate na ordenação. */
  key: string;
  kind: AgendaItemKind;
  at: Date;
  eventId: string;
  eventName: string;
  title: string;
  /** Só para TASK_DUE: prazo já vencido e tarefa ainda não concluída. */
  overdue: boolean;
}

export interface AgendaTask {
  id: string;
  eventId: string;
  title: string;
  status: TaskStatus;
  dueAt: Date | null;
}

export interface BuildAgendaInput {
  events: DashboardEvent[];
  tasks: AgendaTask[];
  now: Date;
  horizonDays?: number;
}

/**
 * Agenda cronológica dos próximos `horizonDays` dias, mais as tarefas já
 * atrasadas (não têm limite inferior — atraso não "expira"). Eventos
 * cancelados/encerrados não geram itens; tarefas de eventos que não vieram em
 * `events` (ex.: encerrados) também são descartadas.
 */
export function buildAgenda({
  events,
  tasks,
  now,
  horizonDays = DEFAULT_AGENDA_HORIZON_DAYS,
}: BuildAgendaInput): AgendaItem[] {
  const horizonEnd = new Date(now.getTime() + horizonDays * DAY_MS);
  const items: AgendaItem[] = [];
  const activeEvents = new Map<string, DashboardEvent>();

  for (const event of events) {
    const phase = classifyEventPhase(event, now);
    if (!isActivePhase(phase)) continue;
    activeEvents.set(event.id, event);

    if (phase === "UPCOMING" && event.startDate <= horizonEnd) {
      items.push({
        key: `event-start:${event.id}`,
        kind: "EVENT_START",
        at: event.startDate,
        eventId: event.id,
        eventName: event.name,
        title: `Início: ${event.name}`,
        overdue: false,
      });
    }
    if (event.endDate >= now && event.endDate <= horizonEnd) {
      items.push({
        key: `event-end:${event.id}`,
        kind: "EVENT_END",
        at: event.endDate,
        eventId: event.id,
        eventName: event.name,
        title: `Término: ${event.name}`,
        overdue: false,
      });
    }
  }

  for (const task of tasks) {
    if (task.status === "DONE" || !task.dueAt) continue;
    const event = activeEvents.get(task.eventId);
    if (!event) continue;
    if (task.dueAt > horizonEnd) continue;
    items.push({
      key: `task-due:${task.id}`,
      kind: "TASK_DUE",
      at: task.dueAt,
      eventId: task.eventId,
      eventName: event.name,
      title: task.title,
      overdue: task.dueAt < now,
    });
  }

  return items.sort((a, b) => a.at.getTime() - b.at.getTime() || a.key.localeCompare(b.key));
}

export interface AgendaGroup {
  /** "OVERDUE" ou "AAAA-MM-DD" (dia em APP_TIME_ZONE). */
  key: string;
  label: string;
  overdue: boolean;
  items: AgendaItem[];
}

function dayKey(date: Date, timeZone: string): string {
  // en-CA formata como AAAA-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function dayLabel(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    weekday: "long",
    day: "2-digit",
    month: "long",
  }).format(date);
}

/**
 * Agrupa a agenda por dia. Tarefas atrasadas vão todas para um grupo "Atrasadas"
 * no topo — um cabeçalho de dia de três semanas atrás no meio da lista seria só ruído.
 * Aceita a agenda já ordenada por `buildAgenda`.
 */
export function groupAgendaByDay(
  items: AgendaItem[],
  timeZone: string = APP_TIME_ZONE
): AgendaGroup[] {
  const groups: AgendaGroup[] = [];
  const overdue = items.filter((i) => i.overdue);
  if (overdue.length > 0) {
    groups.push({ key: "OVERDUE", label: "Atrasadas", overdue: true, items: overdue });
  }

  const byDay = new Map<string, AgendaGroup>();
  for (const item of items) {
    if (item.overdue) continue;
    const key = dayKey(item.at, timeZone);
    let group = byDay.get(key);
    if (!group) {
      group = { key, label: dayLabel(item.at, timeZone), overdue: false, items: [] };
      byDay.set(key, group);
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}
