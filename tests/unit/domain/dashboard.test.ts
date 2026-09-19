import { describe, expect, it } from "vitest";
import {
  buildAgenda,
  buildMetricsByEvent,
  buildPortfolio,
  classifyEventPhase,
  computeEventHealth,
  emptyMetrics,
  groupAgendaByDay,
  requiredChecklistProgress,
  taskProgress,
  type DashboardEvent,
  type EventMetrics,
} from "@/lib/domain/dashboard";

const NOW = new Date("2026-09-18T15:00:00.000Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function at(offsetMs: number): Date {
  return new Date(NOW.getTime() + offsetMs);
}

function makeEvent(overrides: Partial<DashboardEvent> = {}): DashboardEvent {
  return {
    id: "evt-1",
    name: "Festival",
    location: null,
    startDate: at(10 * DAY),
    endDate: at(11 * DAY),
    status: "CONFIRMED",
    ...overrides,
  };
}

function makeMetrics(overrides: Partial<EventMetrics> = {}): EventMetrics {
  return { ...emptyMetrics(), ...overrides };
}

describe("classifyEventPhase", () => {
  it("usa as datas para separar futuro, em andamento e encerrado", () => {
    expect(classifyEventPhase(makeEvent({ startDate: at(HOUR), endDate: at(2 * HOUR) }), NOW)).toBe("UPCOMING");
    expect(classifyEventPhase(makeEvent({ startDate: at(-HOUR), endDate: at(HOUR) }), NOW)).toBe("ONGOING");
    expect(classifyEventPhase(makeEvent({ startDate: at(-3 * HOUR), endDate: at(-HOUR) }), NOW)).toBe("PAST");
  });

  it("os limites exatos de início e fim contam como em andamento", () => {
    expect(classifyEventPhase(makeEvent({ startDate: NOW, endDate: at(HOUR) }), NOW)).toBe("ONGOING");
    expect(classifyEventPhase(makeEvent({ startDate: at(-HOUR), endDate: NOW }), NOW)).toBe("ONGOING");
  });

  it("CANCELLED e COMPLETED sobrepõem as datas", () => {
    expect(classifyEventPhase(makeEvent({ status: "CANCELLED", startDate: at(-HOUR), endDate: at(HOUR) }), NOW)).toBe(
      "CANCELLED"
    );
    expect(classifyEventPhase(makeEvent({ status: "COMPLETED", startDate: at(-HOUR), endDate: at(HOUR) }), NOW)).toBe(
      "PAST"
    );
  });

  it("status IN_PROGRESS não faz um evento futuro virar 'em andamento'", () => {
    expect(classifyEventPhase(makeEvent({ status: "IN_PROGRESS" }), NOW)).toBe("UPCOMING");
  });
});

describe("buildMetricsByEvent", () => {
  it("devolve zeros para eventos sem nenhuma linha e ignora eventos desconhecidos", () => {
    const result = buildMetricsByEvent(["a", "b"], {
      taskCounts: [{ eventId: "a", status: "TODO", count: 1 }, { eventId: "fantasma", status: "TODO", count: 9 }],
      overdueTaskCounts: [],
      openOccurrenceCounts: [],
      requiredItemCounts: [],
    });
    expect(result.get("b")).toEqual(emptyMetrics());
    expect(result.has("fantasma")).toBe(false);
    expect(result.get("a")?.tasksOpen).toBe(1);
  });

  it("agrega tarefas, ocorrências e checklist por evento", () => {
    const result = buildMetricsByEvent(["a"], {
      taskCounts: [
        { eventId: "a", status: "TODO", count: 2 },
        { eventId: "a", status: "IN_PROGRESS", count: 1 },
        { eventId: "a", status: "BLOCKED", count: 3 },
        { eventId: "a", status: "DONE", count: 4 },
      ],
      overdueTaskCounts: [{ eventId: "a", count: 2 }],
      openOccurrenceCounts: [
        { eventId: "a", severity: "LOW", count: 5 },
        { eventId: "a", severity: "HIGH", count: 2 },
        { eventId: "a", severity: "CRITICAL", count: 1 },
      ],
      requiredItemCounts: [
        { eventId: "a", status: "PENDING", count: 3 },
        { eventId: "a", status: "DONE", count: 7 },
        { eventId: "a", status: "NOT_APPLICABLE", count: 9 },
      ],
    });
    expect(result.get("a")).toEqual({
      tasksOpen: 6, // TODO + IN_PROGRESS + BLOCKED
      tasksDone: 4,
      tasksBlocked: 3,
      tasksOverdue: 2,
      occurrencesOpen: 8,
      occurrencesOpenHigh: 3, // HIGH + CRITICAL
      occurrencesOpenCritical: 1,
      requiredItemsPending: 3,
      requiredItemsDone: 7, // NOT_APPLICABLE não entra
    });
  });

  it("progressos retornam null quando não há denominador", () => {
    expect(taskProgress(emptyMetrics())).toBeNull();
    expect(requiredChecklistProgress(emptyMetrics())).toBeNull();
    expect(taskProgress(makeMetrics({ tasksOpen: 1, tasksDone: 3 }))).toBe(0.75);
    expect(requiredChecklistProgress(makeMetrics({ requiredItemsPending: 1, requiredItemsDone: 1 }))).toBe(0.5);
  });
});

describe("computeEventHealth", () => {
  it("OK quando não há nenhum problema", () => {
    expect(computeEventHealth(makeEvent(), makeMetrics(), NOW)).toEqual({ level: "OK", reasons: [] });
  });

  it("CRITICAL quando há ocorrência crítica aberta, listando também as outras razões", () => {
    const health = computeEventHealth(
      makeEvent(),
      makeMetrics({ occurrencesOpenCritical: 1, occurrencesOpenHigh: 3, tasksOverdue: 2 }),
      NOW
    );
    expect(health?.level).toBe("CRITICAL");
    expect(health?.reasons).toEqual([
      { code: "CRITICAL_OCCURRENCES", count: 1 },
      { code: "HIGH_OCCURRENCES", count: 2 }, // 3 HIGH+CRITICAL menos a 1 crítica
      { code: "OVERDUE_TASKS", count: 2 },
    ]);
  });

  it("ATTENTION para tarefa atrasada, bloqueada ou ocorrência grave", () => {
    expect(computeEventHealth(makeEvent(), makeMetrics({ tasksOverdue: 1 }), NOW)?.level).toBe("ATTENTION");
    expect(computeEventHealth(makeEvent(), makeMetrics({ tasksBlocked: 1 }), NOW)?.level).toBe("ATTENTION");
    expect(computeEventHealth(makeEvent(), makeMetrics({ occurrencesOpenHigh: 1 }), NOW)?.level).toBe("ATTENTION");
  });

  it("checklist obrigatório pendente só preocupa perto do evento (≤48h) ou durante ele", () => {
    const pending = makeMetrics({ requiredItemsPending: 2 });
    // Faltam 10 dias: ainda há tempo.
    expect(computeEventHealth(makeEvent(), pending, NOW)?.level).toBe("OK");
    // Faltam 47h.
    expect(
      computeEventHealth(makeEvent({ startDate: at(47 * HOUR), endDate: at(60 * HOUR) }), pending, NOW)?.reasons
    ).toEqual([{ code: "REQUIRED_CHECKLIST_PENDING", count: 2 }]);
    // Em andamento.
    expect(
      computeEventHealth(makeEvent({ startDate: at(-HOUR), endDate: at(HOUR) }), pending, NOW)?.level
    ).toBe("ATTENTION");
  });

  it("devolve null para eventos encerrados ou cancelados (ninguém acompanha)", () => {
    const bad = makeMetrics({ occurrencesOpenCritical: 4, tasksOverdue: 9 });
    expect(computeEventHealth(makeEvent({ startDate: at(-3 * DAY), endDate: at(-2 * DAY) }), bad, NOW)).toBeNull();
    expect(computeEventHealth(makeEvent({ status: "CANCELLED" }), bad, NOW)).toBeNull();
  });
});

describe("buildPortfolio", () => {
  const ongoing = makeEvent({ id: "ongoing", startDate: at(-HOUR), endDate: at(5 * HOUR) });
  const soon = makeEvent({ id: "soon", startDate: at(5 * DAY), endDate: at(6 * DAY) });
  const later = makeEvent({ id: "later", startDate: at(45 * DAY), endDate: at(46 * DAY) });
  const past = makeEvent({ id: "past", startDate: at(-9 * DAY), endDate: at(-8 * DAY) });
  const cancelled = makeEvent({ id: "cancelled", status: "CANCELLED" });

  it("agrupa por fase, ordena e calcula os KPIs só sobre eventos ativos", () => {
    const portfolio = buildPortfolio(
      [
        { event: later, role: "VIEWER", metrics: makeMetrics() },
        { event: past, role: "MANAGER", metrics: makeMetrics({ tasksOverdue: 50, occurrencesOpenCritical: 5 }) },
        { event: cancelled, role: "MANAGER", metrics: makeMetrics({ tasksOverdue: 7 }) },
        { event: soon, role: "MANAGER", metrics: makeMetrics({ tasksOverdue: 2 }) },
        { event: ongoing, role: "MANAGER", metrics: makeMetrics({ occurrencesOpenCritical: 1 }) },
      ],
      NOW
    );

    expect(portfolio.ongoing.map((e) => e.event.id)).toEqual(["ongoing"]);
    expect(portfolio.upcoming.map((e) => e.event.id)).toEqual(["soon", "later"]);
    expect(portfolio.past.map((e) => e.event.id)).toEqual(["past"]);
    expect(portfolio.cancelled.map((e) => e.event.id)).toEqual(["cancelled"]);

    expect(portfolio.kpis).toEqual({
      ongoingCount: 1,
      upcomingSoonCount: 1, // "later" começa em 45 dias, fora da janela de 30
      tasksOverdue: 2, // os 50 atrasos do evento encerrado e os 7 do cancelado não contam
      occurrencesOpenCritical: 1,
      eventsNeedingAttention: 2, // ongoing (crítico) e soon (atrasos)
    });
  });

  it("lista vazia gera portfólio vazio com KPIs zerados", () => {
    const portfolio = buildPortfolio([], NOW);
    expect(portfolio.ongoing).toEqual([]);
    expect(portfolio.kpis).toEqual({
      ongoingCount: 0,
      upcomingSoonCount: 0,
      tasksOverdue: 0,
      occurrencesOpenCritical: 0,
      eventsNeedingAttention: 0,
    });
  });
});

describe("buildAgenda", () => {
  const upcoming = makeEvent({ id: "up", name: "Show", startDate: at(2 * DAY), endDate: at(3 * DAY) });

  it("inclui início e término de eventos ativos dentro do horizonte, em ordem cronológica", () => {
    const agenda = buildAgenda({ events: [upcoming], tasks: [], now: NOW });
    expect(agenda.map((i) => [i.kind, i.eventId])).toEqual([
      ["EVENT_START", "up"],
      ["EVENT_END", "up"],
    ]);
  });

  it("ignora eventos fora do horizonte de 14 dias", () => {
    const far = makeEvent({ id: "far", startDate: at(20 * DAY), endDate: at(21 * DAY) });
    expect(buildAgenda({ events: [far], tasks: [], now: NOW })).toEqual([]);
  });

  it("evento em andamento só mostra o término (o início já passou)", () => {
    const running = makeEvent({ id: "run", startDate: at(-HOUR), endDate: at(2 * HOUR) });
    expect(buildAgenda({ events: [running], tasks: [], now: NOW }).map((i) => i.kind)).toEqual(["EVENT_END"]);
  });

  it("ignora eventos encerrados/cancelados e tarefas de eventos que não estão ativos", () => {
    const past = makeEvent({ id: "past", startDate: at(-3 * DAY), endDate: at(-2 * DAY) });
    const cancelled = makeEvent({ id: "cx", status: "CANCELLED", startDate: at(DAY), endDate: at(2 * DAY) });
    const agenda = buildAgenda({
      events: [past, cancelled],
      tasks: [
        { id: "t1", eventId: "past", title: "x", status: "TODO", dueAt: at(-DAY) },
        { id: "t2", eventId: "cx", title: "y", status: "TODO", dueAt: at(DAY) },
        { id: "t3", eventId: "desconhecido", title: "z", status: "TODO", dueAt: at(DAY) },
      ],
      now: NOW,
    });
    expect(agenda).toEqual([]);
  });

  it("tarefas: atrasadas entram (sem limite inferior) e ficam marcadas; concluídas e sem prazo não entram", () => {
    const agenda = buildAgenda({
      events: [upcoming],
      tasks: [
        { id: "late", eventId: "up", title: "Atrasada há 30 dias", status: "TODO", dueAt: at(-30 * DAY) },
        { id: "soon", eventId: "up", title: "Vence amanhã", status: "IN_PROGRESS", dueAt: at(DAY) },
        { id: "done", eventId: "up", title: "Feita", status: "DONE", dueAt: at(-DAY) },
        { id: "nodue", eventId: "up", title: "Sem prazo", status: "TODO", dueAt: null },
        { id: "far", eventId: "up", title: "Muito longe", status: "TODO", dueAt: at(40 * DAY) },
      ],
      now: NOW,
    });
    expect(agenda.map((i) => i.key)).toEqual([
      "task-due:late",
      "task-due:soon",
      "event-start:up",
      "event-end:up",
    ]);
    expect(agenda[0]?.overdue).toBe(true);
    expect(agenda[1]?.overdue).toBe(false);
  });

  it("empate de horário é resolvido de forma determinística pela chave", () => {
    const tasks = [
      { id: "b", eventId: "up", title: "B", status: "TODO" as const, dueAt: at(DAY) },
      { id: "a", eventId: "up", title: "A", status: "TODO" as const, dueAt: at(DAY) },
    ];
    const keys = buildAgenda({ events: [upcoming], tasks, now: NOW })
      .filter((i) => i.kind === "TASK_DUE")
      .map((i) => i.key);
    expect(keys).toEqual(["task-due:a", "task-due:b"]);
  });
});

describe("groupAgendaByDay", () => {
  it("põe atrasadas num grupo próprio no topo e agrupa o resto por dia no fuso de São Paulo", () => {
    const event = makeEvent({ id: "up", startDate: at(2 * DAY), endDate: at(2 * DAY + HOUR) });
    const agenda = buildAgenda({
      events: [event],
      tasks: [
        { id: "late", eventId: "up", title: "Atrasada", status: "TODO", dueAt: at(-20 * DAY) },
        // 2026-09-19T23:30-03:00 = 2026-09-20T02:30Z — mesmo dia (19) em São Paulo, dia 20 em UTC.
        { id: "night", eventId: "up", title: "Noite", status: "TODO", dueAt: new Date("2026-09-20T02:30:00.000Z") },
        { id: "morning", eventId: "up", title: "Manhã", status: "TODO", dueAt: new Date("2026-09-19T12:00:00.000Z") },
      ],
      now: NOW,
    });

    const groups = groupAgendaByDay(agenda, "America/Sao_Paulo");
    expect(groups[0]).toMatchObject({ key: "OVERDUE", label: "Atrasadas", overdue: true });
    expect(groups[0]?.items.map((i) => i.key)).toEqual(["task-due:late"]);

    const day19 = groups.find((g) => g.key === "2026-09-19");
    expect(day19?.items.map((i) => i.key)).toEqual(["task-due:morning", "task-due:night"]);
    expect(groups.find((g) => g.key === "2026-09-20")).toMatchObject({
      items: [expect.objectContaining({ key: "event-start:up" }), expect.objectContaining({ key: "event-end:up" })],
    });
  });

  it("agenda vazia gera zero grupos", () => {
    expect(groupAgendaByDay([])).toEqual([]);
  });
});
