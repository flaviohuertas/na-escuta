import { prisma } from "@/lib/db/prisma";
import {
  AccessStatus,
  ChecklistItemStatus,
  OccurrenceStatus,
  TaskStatus,
} from "@/generated/prisma/enums";
import {
  buildAgenda,
  buildMetricsByEvent,
  buildPortfolio,
  classifyEventPhase,
  DEFAULT_AGENDA_HORIZON_DAYS,
  isActivePhase,
  type AgendaItem,
  type DashboardEvent,
  type Portfolio,
} from "@/lib/domain/dashboard";
import type { EventStatus } from "@/lib/domain/event.schema";

export interface DashboardData {
  generatedAt: Date;
  portfolio: Portfolio;
  agenda: AgendaItem[];
}

/** Teto de tarefas na agenda — o Painel é um resumo, não a lista completa de tarefas. */
const AGENDA_TASK_LIMIT = 200;

/**
 * Carrega o Painel do usuário: portfólio de eventos + agenda. Só enxerga eventos
 * onde o usuário tem EventAccess ATIVO *e* Membership ATIVO na empresa dona do
 * evento (mesma regra de `authorizeEventAccess`) — um vínculo revogado com a
 * empresa esconde os eventos mesmo que o EventAccess tenha ficado para trás.
 *
 * Tudo é agregado no banco (`groupBy`), nunca contando linha por linha em memória.
 * Exige conexão, como o catálogo `/eventos`: é uma visão gerencial ao vivo, não
 * um dado operacional de campo que precise funcionar offline.
 */
export async function loadDashboard(userId: string, now: Date = new Date()): Promise<DashboardData> {
  const accessRows = await prisma.eventAccess.findMany({
    where: {
      userId,
      status: AccessStatus.ACTIVE,
      event: {
        deletedAt: null,
        company: { memberships: { some: { userId, status: AccessStatus.ACTIVE } } },
      },
    },
    include: { event: true },
  });

  const events: DashboardEvent[] = accessRows.map(({ event }) => ({
    id: event.id,
    name: event.name,
    location: event.location,
    startDate: event.startDate,
    endDate: event.endDate,
    // `status` é String no schema (não enum Prisma); o cliente/servidor validam via Zod na escrita.
    status: event.status as EventStatus,
  }));
  const eventIds = events.map((e) => e.id);

  if (eventIds.length === 0) {
    return { generatedAt: now, portfolio: buildPortfolio([], now), agenda: [] };
  }

  const horizonEnd = new Date(now.getTime() + DEFAULT_AGENDA_HORIZON_DAYS * 24 * 60 * 60 * 1000);
  // A agenda só lista eventos ativos; filtrar aqui evita que tarefas atrasadas de
  // eventos já encerrados consumam o limite antes de `buildAgenda` descartá-las.
  const activeEventIds = events
    .filter((e) => isActivePhase(classifyEventPhase(e, now)))
    .map((e) => e.id);

  const [taskCounts, overdueTaskCounts, openOccurrenceCounts, requiredItemCounts, agendaTasks] =
    await Promise.all([
      prisma.task.groupBy({
        by: ["eventId", "status"],
        where: { eventId: { in: eventIds }, deletedAt: null },
        _count: { _all: true },
      }),
      prisma.task.groupBy({
        by: ["eventId"],
        where: {
          eventId: { in: eventIds },
          deletedAt: null,
          status: { not: TaskStatus.DONE },
          dueAt: { lt: now },
        },
        _count: { _all: true },
      }),
      prisma.occurrence.groupBy({
        by: ["eventId", "severity"],
        where: {
          eventId: { in: eventIds },
          deletedAt: null,
          status: { in: [OccurrenceStatus.OPEN, OccurrenceStatus.IN_PROGRESS] },
        },
        _count: { _all: true },
      }),
      prisma.checklistItem.groupBy({
        by: ["eventId", "status"],
        where: {
          eventId: { in: eventIds },
          deletedAt: null,
          isRequired: true,
          status: { in: [ChecklistItemStatus.PENDING, ChecklistItemStatus.DONE] },
          checklist: { deletedAt: null },
        },
        _count: { _all: true },
      }),
      prisma.task.findMany({
        where: {
          eventId: { in: activeEventIds },
          deletedAt: null,
          status: { not: TaskStatus.DONE },
          dueAt: { not: null, lte: horizonEnd },
        },
        select: { id: true, eventId: true, title: true, status: true, dueAt: true },
        orderBy: { dueAt: "asc" },
        take: AGENDA_TASK_LIMIT,
      }),
    ]);

  const metricsByEvent = buildMetricsByEvent(eventIds, {
    taskCounts: taskCounts.map((r) => ({ eventId: r.eventId, status: r.status, count: r._count._all })),
    overdueTaskCounts: overdueTaskCounts.map((r) => ({ eventId: r.eventId, count: r._count._all })),
    openOccurrenceCounts: openOccurrenceCounts.map((r) => ({
      eventId: r.eventId,
      severity: r.severity,
      count: r._count._all,
    })),
    requiredItemCounts: requiredItemCounts.map((r) => ({
      eventId: r.eventId,
      status: r.status,
      count: r._count._all,
    })),
  });

  const roleByEvent = new Map(accessRows.map((row) => [row.eventId, row.role]));
  const portfolio = buildPortfolio(
    events.map((event) => ({
      event,
      role: roleByEvent.get(event.id) ?? "VIEWER",
      // buildMetricsByEvent devolve entrada para todo id em eventIds.
      metrics: metricsByEvent.get(event.id)!,
    })),
    now
  );

  const agenda = buildAgenda({
    events,
    tasks: agendaTasks.map((t) => ({
      id: t.id,
      eventId: t.eventId,
      title: t.title,
      status: t.status,
      dueAt: t.dueAt,
    })),
    now,
  });

  return { generatedAt: now, portfolio, agenda };
}
