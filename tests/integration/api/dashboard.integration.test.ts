/**
 * Testes de integração — exigem Postgres real (ver cabeçalho de
 * sync-push.integration.test.ts). Escritos junto com o Painel gerencial, mas
 * NÃO executados na sessão em que foram criados (sem Docker/Postgres disponível).
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createMembership,
  createTestCompany,
  createTestEvent,
  createTestPrismaClient,
  createTestUser,
  grantEventAccess,
  truncateAll,
} from "../helpers/factories";
import { loadDashboard } from "@/server/dashboard/dashboard.service";

const prisma = createTestPrismaClient();
const NOW = new Date("2026-09-18T15:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

describe("Painel gerencial (integração — Postgres real)", () => {
  beforeEach(async () => {
    await truncateAll(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function setup() {
    const company = await createTestCompany(prisma);
    const user = await createTestUser(prisma);
    await createMembership(prisma, user.id, company.id, "PRODUCER");
    const event = await prisma.event.create({
      data: {
        companyId: company.id,
        name: "Evento do Painel",
        startDate: new Date(NOW.getTime() + 5 * DAY),
        endDate: new Date(NOW.getTime() + 6 * DAY),
        status: "CONFIRMED",
      },
    });
    await grantEventAccess(prisma, user.id, event.id, "MANAGER");
    return { company, user, event };
  }

  it("agrega tarefas, ocorrências e checklist ignorando registros excluídos (tombstone)", async () => {
    const { company, user, event } = await setup();
    const base = { eventId: event.id, companyId: company.id };

    await prisma.task.createMany({
      data: [
        { ...base, title: "Atrasada", status: "TODO", dueAt: new Date(NOW.getTime() - DAY) },
        { ...base, title: "Bloqueada", status: "BLOCKED" },
        { ...base, title: "Feita", status: "DONE", dueAt: new Date(NOW.getTime() - DAY) },
        { ...base, title: "Excluída", status: "TODO", dueAt: new Date(NOW.getTime() - DAY), deletedAt: NOW },
      ],
    });
    await prisma.occurrence.createMany({
      data: [
        { ...base, title: "Crítica aberta", severity: "CRITICAL", status: "OPEN", occurredAt: NOW },
        { ...base, title: "Resolvida", severity: "CRITICAL", status: "RESOLVED", occurredAt: NOW },
        { ...base, title: "Excluída", severity: "CRITICAL", status: "OPEN", occurredAt: NOW, deletedAt: NOW },
      ],
    });
    const checklist = await prisma.checklistTemplate.create({ data: { ...base, title: "Montagem" } });
    await prisma.checklistItem.createMany({
      data: [
        { ...base, checklistId: checklist.id, label: "Obrigatório pendente", isRequired: true, status: "PENDING" },
        { ...base, checklistId: checklist.id, label: "Obrigatório feito", isRequired: true, status: "DONE" },
        { ...base, checklistId: checklist.id, label: "Obrigatório N/A", isRequired: true, status: "NOT_APPLICABLE" },
        { ...base, checklistId: checklist.id, label: "Opcional pendente", isRequired: false, status: "PENDING" },
      ],
    });

    const { portfolio, agenda } = await loadDashboard(user.id, NOW);

    expect(portfolio.upcoming).toHaveLength(1);
    const [entry] = portfolio.upcoming;
    expect(entry?.role).toBe("MANAGER");
    expect(entry?.metrics).toMatchObject({
      tasksOpen: 2, // Atrasada + Bloqueada (a Excluída não conta)
      tasksDone: 1,
      tasksBlocked: 1,
      tasksOverdue: 1,
      occurrencesOpen: 1,
      occurrencesOpenCritical: 1,
      requiredItemsPending: 1,
      requiredItemsDone: 1,
    });
    expect(entry?.health?.level).toBe("CRITICAL");
    expect(agenda.some((i) => i.kind === "TASK_DUE" && i.title === "Atrasada" && i.overdue)).toBe(true);
    expect(agenda.some((i) => i.title === "Excluída")).toBe(false);
  });

  it("não mostra eventos de outra empresa", async () => {
    const { event } = await setup();
    const outsider = await createTestUser(prisma);
    const otherCompany = await createTestCompany(prisma);
    await createMembership(prisma, outsider.id, otherCompany.id, "PRODUCER");

    const { portfolio } = await loadDashboard(outsider.id, NOW);
    const allIds = [...portfolio.ongoing, ...portfolio.upcoming, ...portfolio.past, ...portfolio.cancelled].map(
      (e) => e.event.id
    );
    expect(allIds).not.toContain(event.id);
  });

  it("Membership revogado esconde os eventos mesmo com EventAccess ainda ativo", async () => {
    const { user, company } = await setup();
    await prisma.membership.update({
      where: { userId_companyId: { userId: user.id, companyId: company.id } },
      data: { status: "REVOKED", revokedAt: NOW },
    });

    const { portfolio, agenda } = await loadDashboard(user.id, NOW);
    expect(portfolio.upcoming).toHaveLength(0);
    expect(agenda).toEqual([]);
  });

  it("EventAccess revogado e evento excluído também somem do portfólio", async () => {
    const { user, company, event } = await setup();
    const second = await createTestEvent(prisma, company.id);
    await grantEventAccess(prisma, user.id, second.id, "VIEWER");
    await prisma.eventAccess.update({
      where: { userId_eventId: { userId: user.id, eventId: event.id } },
      data: { status: "REVOKED", revokedAt: NOW },
    });
    await prisma.event.update({ where: { id: second.id }, data: { deletedAt: NOW } });

    const { portfolio } = await loadDashboard(user.id, NOW);
    const allIds = [...portfolio.ongoing, ...portfolio.upcoming, ...portfolio.past, ...portfolio.cancelled];
    expect(allIds).toHaveLength(0);
  });

  it("usuário sem nenhum evento recebe portfólio e agenda vazios", async () => {
    const user = await createTestUser(prisma);
    const { portfolio, agenda } = await loadDashboard(user.id, NOW);
    expect(portfolio.kpis.ongoingCount).toBe(0);
    expect(agenda).toEqual([]);
  });
});
