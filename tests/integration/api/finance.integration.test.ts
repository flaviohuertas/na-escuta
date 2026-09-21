/**
 * Financeiro do evento — custo REALIZADO (integração — Postgres real, ver cabeçalho de
 * sync-push.integration.test.ts).
 *
 * O que importa: só titular e administração veem e lançam (e nunca o de outra empresa); dinheiro
 * nunca é apagado (estorna-se, com motivo, e o estornado sai dos totais mas continua na lista);
 * edição e estorno concorrentes nunca se sobrescrevem nem duplicam; e a comparação com o orçamento
 * previsto por categoria diz o que estourou, o que coube e o que foi gasto sem previsão.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createMembership,
  createTestCompany,
  createTestEvent,
  createTestPrismaClient,
  createTestUser,
  truncateAll,
} from "../helpers/factories";
import { saveBudget } from "@/server/crm/budget.service";
import { createClient } from "@/server/crm/client.service";
import { convertToEvent, createOpportunity } from "@/server/crm/opportunity.service";
import { changeProposalStatus, createProposal } from "@/server/crm/proposal.service";
import { createExpense, getEventFinance, getExpense, listFinanceOverview, updateExpense, voidExpense } from "@/server/finance/finance.service";

const prisma = createTestPrismaClient();

type CompanyRole = "OWNER" | "ADMIN" | "PRODUCER" | "STAFF" | "FREELANCER" | "VIEWER";
type Ctx = { userId: string; companyId: string };

const adminError = (status: number) => expect.objectContaining({ name: "AdminActionError", status });

const NOW = new Date("2027-01-05T15:00:00.000Z");

const expenseInput = (overrides: Record<string, unknown> = {}) =>
  ({
    category: "AV",
    description: "Sonorização — sinal",
    supplier: null,
    amountCents: 300_000,
    expenseDate: "2027-01-08",
    notes: null,
    ...overrides,
  }) as never;

const updateInput = (baseVersion: number, overrides: Record<string, unknown> = {}) => ({ ...(expenseInput(overrides) as object), baseVersion }) as never;
const voidInput = (baseVersion: number, reason = "Lançado no evento errado") => ({ reason, baseVersion }) as never;

describe("financeiro do evento (integração — Postgres real)", () => {
  beforeEach(async () => {
    await truncateAll(prisma);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function person(companyId: string, role: CompanyRole = "ADMIN") {
    const user = await createTestUser(prisma);
    await createMembership(prisma, user.id, companyId, role);
    return user;
  }

  async function setup() {
    const company = await createTestCompany(prisma);
    const owner = await person(company.id, "OWNER");
    const event = await createTestEvent(prisma, company.id);
    return { company, owner, event, ctx: { userId: owner.id, companyId: company.id } as Ctx };
  }

  const add = (ctx: Ctx, eventId: string, overrides: Record<string, unknown> = {}) => createExpense({ ...ctx, eventId, input: expenseInput(overrides) });

  /**
   * Uma oportunidade com orçamento (R$ 6.000,00 de som + R$ 2.000,00 de equipe = R$ 8.000,00) e
   * proposta ACEITA de R$ 10.500,00, já transformada em evento. Devolve o evento.
   */
  async function eventFromOpportunity(ctx: Ctx, options: { budget?: boolean; proposal?: boolean } = {}) {
    const { budget = true, proposal = true } = options;
    const client = await createClient({ ...ctx, input: { name: `Cliente ${Math.random().toString(36).slice(2, 8)}`, kind: "COMPANY", document: null, email: null, phone: null, notes: null } as never });
    const opportunity = await createOpportunity({
      ...ctx,
      input: { clientId: client.id, title: "Festival de Verão", description: null, expectedValueCents: null, expectedStartDate: null, expectedEndDate: null, ownerUserId: null } as never,
    });
    if (budget) {
      await saveBudget({
        ...ctx,
        opportunityId: opportunity.id,
        input: {
          items: [
            { category: "AV", description: "Sonorização", quantity: 2, unitCostCents: 300_000, supplier: null },
            { category: "STAFF", description: "Técnicos", quantity: 10, unitCostCents: 20_000, supplier: null },
          ],
          notes: null,
          baseVersion: 0,
        } as never,
      });
    }
    if (proposal) {
      const draft = await createProposal({
        ...ctx,
        opportunityId: opportunity.id,
        input: { items: [{ description: "Produção", quantity: 2, unitPriceCents: 550_000 }], discountCents: 50_000, validUntil: "2027-01-31", notes: null, copiedFromProposalId: null } as never,
      });
      const sent = await changeProposalStatus({ ...ctx, proposalId: draft.id, input: { action: "SEND", baseVersion: draft.version, note: null } as never, now: NOW });
      await changeProposalStatus({ ...ctx, proposalId: draft.id, input: { action: "ACCEPT", baseVersion: sent.proposal!.version, note: null } as never, now: NOW });
    }
    const current = await prisma.opportunity.findUniqueOrThrow({ where: { id: opportunity.id } });
    const converted = await convertToEvent({
      ...ctx,
      opportunityId: opportunity.id,
      input: { event: { name: "Festival de Verão 2027", description: null, location: null, startDate: "2027-01-10T12:00:00.000Z", endDate: "2027-01-12T12:00:00.000Z", status: "PLANNED" }, baseVersion: current.version } as never,
    });
    return converted.event;
  }

  describe("quem acessa", () => {
    it("titular e administração veem e lançam", async () => {
      const { company, event } = await setup();
      for (const role of ["OWNER", "ADMIN"] as const) {
        const user = await person(company.id, role);
        const c = { userId: user.id, companyId: company.id };
        const created = await add(c, event.id, { description: `Do ${role}` });
        expect(created).toMatchObject({ description: `Do ${role}`, createdBy: user.id });
        await expect(getEventFinance({ ...c, eventId: event.id }), role).resolves.toMatchObject({ event: { id: event.id } });
        await expect(listFinanceOverview(c), role).resolves.toMatchObject({ rows: expect.any(Array) });
      }
    });

    it("produção, equipe, freelancer e visualização NÃO acessam o financeiro (403) — em nenhuma função", async () => {
      const { company, ctx, event } = await setup();
      const expense = await add(ctx, event.id);

      for (const role of ["PRODUCER", "STAFF", "FREELANCER", "VIEWER"] as const) {
        const user = await person(company.id, role);
        const c = { userId: user.id, companyId: company.id };
        const calls: Array<[string, () => Promise<unknown>]> = [
          ["listFinanceOverview", () => listFinanceOverview(c)],
          ["getEventFinance", () => getEventFinance({ ...c, eventId: event.id })],
          ["getExpense", () => getExpense({ ...c, expenseId: expense.id })],
          ["createExpense", () => add(c, event.id)],
          ["updateExpense", () => updateExpense({ ...c, expenseId: expense.id, input: updateInput(1, { description: "invadido" }) })],
          ["voidExpense", () => voidExpense({ ...c, expenseId: expense.id, input: voidInput(1) })],
        ];
        for (const [name, call] of calls) {
          await expect(call(), `${role} → ${name}`).rejects.toEqual(adminError(403));
        }
      }
      const stored = await prisma.eventExpense.findMany();
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({ version: 1, description: "Sonorização — sinal", voidedAt: null });
    });

    it("vínculo encerrado e rebaixamento: 403 na chamada seguinte (o papel é lido do banco)", async () => {
      const { company, event } = await setup();
      const admin = await person(company.id, "ADMIN");
      const c = { userId: admin.id, companyId: company.id };
      await expect(add(c, event.id)).resolves.toMatchObject({ version: 1 });

      await prisma.membership.updateMany({ where: { userId: admin.id }, data: { role: "PRODUCER" } });
      await expect(add(c, event.id)).rejects.toEqual(adminError(403));

      await prisma.membership.updateMany({ where: { userId: admin.id }, data: { role: "ADMIN", status: "REVOKED" } });
      await expect(getEventFinance({ ...c, eventId: event.id })).rejects.toEqual(adminError(403));
    });

    it("quem é de OUTRA empresa não enxerga, lança, edita nem estorna nada desta (404)", async () => {
      const { ctx, event } = await setup();
      const expense = await add(ctx, event.id);
      const other = await createTestCompany(prisma);
      const outsider = await person(other.id, "OWNER");
      const theirs = { userId: outsider.id, companyId: other.id };

      await expect(getEventFinance({ ...theirs, eventId: event.id })).rejects.toEqual(adminError(404));
      await expect(add(theirs, event.id)).rejects.toEqual(adminError(404));
      await expect(getExpense({ ...theirs, expenseId: expense.id })).rejects.toEqual(adminError(404));
      await expect(updateExpense({ ...theirs, expenseId: expense.id, input: updateInput(1, { description: "invadido" }) })).rejects.toEqual(adminError(404));
      await expect(voidExpense({ ...theirs, expenseId: expense.id, input: voidInput(1) })).rejects.toEqual(adminError(404));
      expect((await listFinanceOverview(theirs)).rows).toEqual([]);
      expect(await prisma.eventExpense.count()).toBe(1);
      expect((await prisma.eventExpense.findFirstOrThrow()).voidedAt).toBeNull();
    });
  });

  describe("lançar", () => {
    it("grava o valor em centavos, o dia sem fuso e a auditoria (com o evento)", async () => {
      const { ctx, event } = await setup();

      const created = await add(ctx, event.id, { supplier: "Som Alfa", amountCents: 123_456, expenseDate: "2027-01-10", notes: "Sinal de 50%", category: "FOOD" });

      expect(created).toMatchObject({ category: "FOOD", supplier: "Som Alfa", amountCents: 123_456, notes: "Sinal de 50%", version: 1, voidedAt: null });
      expect(created.expenseDate.toISOString().slice(0, 10)).toBe("2027-01-10");
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityType: "EventExpense", entityId: created.id } });
      expect(audit).toMatchObject({ action: "EXPENSE_CREATED", userId: ctx.userId, eventId: event.id, companyId: ctx.companyId });
      expect(audit.afterJson).toMatchObject({ amountCents: 123_456, expenseDate: "2027-01-10", category: "FOOD" });
    });

    it("evento que não existe (ou foi apagado) é 404, e nada é criado", async () => {
      const { ctx, event } = await setup();

      await expect(add(ctx, "00000000-0000-4000-8000-000000000000")).rejects.toEqual(adminError(404));
      await prisma.event.update({ where: { id: event.id }, data: { deletedAt: new Date() } });
      await expect(add(ctx, event.id)).rejects.toEqual(adminError(404));
      expect(await prisma.eventExpense.count()).toBe(0);
    });

    it("vários lançamentos ao mesmo tempo: todos entram, sem perder nenhum", async () => {
      const { ctx, event } = await setup();

      await Promise.all(Array.from({ length: 10 }, (_, i) => add(ctx, event.id, { description: `Lançamento ${i}`, amountCents: 1000 * (i + 1) })));

      const view = await getEventFinance({ ...ctx, eventId: event.id });
      expect(view.expenses).toHaveLength(10);
      expect(view.comparison.realizedTotalCents).toBe(55_000);
    });
  });

  describe("editar", () => {
    it("troca os campos, sobe a versão e grava antes e depois", async () => {
      const { ctx, event } = await setup();
      const created = await add(ctx, event.id);

      const updated = await updateExpense({ ...ctx, expenseId: created.id, input: updateInput(1, { amountCents: 350_000, description: "Sonorização — total", category: "STRUCTURE", expenseDate: "2027-01-09" }) });

      expect(updated).toMatchObject({ version: 2, amountCents: 350_000, description: "Sonorização — total", category: "STRUCTURE", updatedBy: ctx.userId });
      expect(updated.expenseDate.toISOString().slice(0, 10)).toBe("2027-01-09");
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: created.id, action: "EXPENSE_UPDATED" } });
      expect(audit.beforeJson).toMatchObject({ amountCents: 300_000, category: "AV" });
      expect(audit.afterJson).toMatchObject({ amountCents: 350_000, category: "STRUCTURE" });
    });

    it("versão velha: 409 e o que a outra pessoa gravou fica", async () => {
      const { ctx, event } = await setup();
      const created = await add(ctx, event.id);
      await updateExpense({ ...ctx, expenseId: created.id, input: updateInput(1, { amountCents: 111 }) });

      await expect(updateExpense({ ...ctx, expenseId: created.id, input: updateInput(1, { amountCents: 222 }) })).rejects.toMatchObject({
        status: 409,
        message: expect.stringContaining("alterado por outra pessoa"),
      });
      expect((await prisma.eventExpense.findFirstOrThrow()).amountCents).toBe(111);
    });

    it("um lançamento ESTORNADO não se edita (409)", async () => {
      const { ctx, event } = await setup();
      const created = await add(ctx, event.id);
      await voidExpense({ ...ctx, expenseId: created.id, input: voidInput(1) });

      await expect(updateExpense({ ...ctx, expenseId: created.id, input: updateInput(2, { amountCents: 1 }) })).rejects.toMatchObject({
        status: 409,
        message: expect.stringContaining("estornado"),
      });
      expect((await prisma.eventExpense.findFirstOrThrow()).amountCents).toBe(300_000);
    });
  });

  describe("estornar (dinheiro nunca se apaga)", () => {
    it("marca quem, quando e por quê; o lançamento continua na lista e sai dos totais", async () => {
      const { ctx, event } = await setup();
      const keep = await add(ctx, event.id, { description: "Fica", amountCents: 100_000 });
      const wrong = await add(ctx, event.id, { description: "Errado", amountCents: 900_000 });

      const voided = await voidExpense({ ...ctx, expenseId: wrong.id, input: voidInput(1, "Lançado no evento errado") });

      expect(voided).toMatchObject({ voidReason: "Lançado no evento errado", voidedBy: ctx.userId, version: 2, amountCents: 900_000 });
      expect(voided.voidedAt).toBeInstanceOf(Date);
      expect(await prisma.eventExpense.count()).toBe(2); // nada foi apagado
      const view = await getEventFinance({ ...ctx, eventId: event.id });
      expect(view.expenses.map((e) => [e.description, e.voidedAt !== null])).toEqual(expect.arrayContaining([["Fica", false], ["Errado", true]]));
      expect(view.comparison.realizedTotalCents).toBe(100_000); // o estornado não conta
      expect(keep.voidedAt).toBeNull();
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: wrong.id, action: "EXPENSE_VOIDED" } });
      expect(audit.metadata).toMatchObject({ reason: "Lançado no evento errado" });
    });

    it("estornar de novo, ou com a versão velha, recebe 409 e nada muda", async () => {
      const { ctx, event } = await setup();
      const created = await add(ctx, event.id);
      await voidExpense({ ...ctx, expenseId: created.id, input: voidInput(1) });

      await expect(voidExpense({ ...ctx, expenseId: created.id, input: voidInput(2, "de novo") })).rejects.toMatchObject({ status: 409, message: expect.stringContaining("estornado") });

      const other = await add(ctx, event.id, { description: "Outro" });
      await updateExpense({ ...ctx, expenseId: other.id, input: updateInput(1, { amountCents: 5 }) });
      await expect(voidExpense({ ...ctx, expenseId: other.id, input: voidInput(1) })).rejects.toMatchObject({ status: 409, message: expect.stringContaining("alterado por outra pessoa") });
      expect((await prisma.eventExpense.findUniqueOrThrow({ where: { id: other.id } })).voidedAt).toBeNull();
      expect(await prisma.auditLog.count({ where: { action: "EXPENSE_VOIDED" } })).toBe(1);
    });
  });

  describe("previsto × realizado", () => {
    it("por categoria: estourou, coube e gastou sem previsão — com a margem prevista e a realizada", async () => {
      const { ctx } = await setup();
      const event = await eventFromOpportunity(ctx);
      await add(ctx, event.id, { category: "AV", amountCents: 400_000 });
      await add(ctx, event.id, { category: "AV", amountCents: 250_000 }); // AV: 6.500 de 6.000 previstos → estourou
      await add(ctx, event.id, { category: "FOOD", amountCents: 30_000 }); // sem previsão
      const gone = await add(ctx, event.id, { category: "STAFF", amountCents: 999_999 });
      await voidExpense({ ...ctx, expenseId: gone.id, input: voidInput(1) }); // estornado: não conta

      const view = await getEventFinance({ ...ctx, eventId: event.id });

      expect(view.comparison.rows.map((r) => [r.category, r.plannedCents, r.realizedCents, r.varianceCents, r.consumedBps, r.status])).toEqual([
        ["AV", 600_000, 650_000, 50_000, 10833, "OVER"],
        ["FOOD", 0, 30_000, 30_000, null, "UNPLANNED"],
        ["STAFF", 200_000, 0, -200_000, 0, "WITHIN"],
      ]);
      expect(view.comparison).toMatchObject({ hasBudget: true, plannedTotalCents: 800_000, realizedTotalCents: 680_000, varianceTotalCents: -120_000, consumedTotalBps: 8500 });
      expect(view.revenue).toMatchObject({ kind: "ACCEPTED", cents: 1_050_000, label: "Proposta v1 (aceita)" });
      expect(view.plannedMargin).toEqual({ marginCents: 250_000, marginBps: 2381 });
      expect(view.realizedMargin).toEqual({ marginCents: 370_000, marginBps: 3524 });
      expect(view.opportunity).toMatchObject({ title: "Festival de Verão" });
    });

    it("evento criado direto (sem oportunidade): só o realizado, sem orçamento nem receita nem margem", async () => {
      const { ctx, event } = await setup();
      await add(ctx, event.id, { category: "AV", amountCents: 300_000 });

      const view = await getEventFinance({ ...ctx, eventId: event.id });

      expect(view.opportunity).toBeNull();
      expect(view.comparison).toMatchObject({ hasBudget: false, realizedTotalCents: 300_000, plannedTotalCents: 0, consumedTotalBps: null });
      expect(view.comparison.rows).toEqual([expect.objectContaining({ category: "AV", hasPlan: false, status: "UNPLANNED" })]);
      expect(view.revenue).toBeNull();
      expect(view.plannedMargin).toBeNull();
      expect(view.realizedMargin).toBeNull();
    });

    it("oportunidade sem orçamento: há receita e margem realizada, mas nenhuma margem prevista", async () => {
      const { ctx } = await setup();
      const event = await eventFromOpportunity(ctx, { budget: false });
      await add(ctx, event.id, { category: "AV", amountCents: 300_000 });

      const view = await getEventFinance({ ...ctx, eventId: event.id });

      expect(view.comparison.hasBudget).toBe(false);
      expect(view.plannedMargin).toBeNull();
      expect(view.realizedMargin).toEqual({ marginCents: 750_000, marginBps: 7143 });
    });

    it("sem nenhum gasto ainda: tudo dentro do previsto e a margem realizada é a receita inteira", async () => {
      const { ctx } = await setup();
      const event = await eventFromOpportunity(ctx);

      const view = await getEventFinance({ ...ctx, eventId: event.id });

      expect(view.comparison.rows.every((r) => r.status === "WITHIN" && r.realizedCents === 0)).toBe(true);
      expect(view.realizedMargin).toEqual({ marginCents: 1_050_000, marginBps: 10000 });
      expect(view.expenses).toEqual([]);
    });
  });

  describe("visão geral dos eventos", () => {
    it("cada evento com o previsto, o realizado (só ativos), a receita e a margem até agora — sem eventos de outra empresa", async () => {
      const { ctx, event: plain } = await setup(); // criado direto, sem oportunidade
      const withBudget = await eventFromOpportunity(ctx);
      await add(ctx, withBudget.id, { amountCents: 400_000 });
      const gone = await add(ctx, withBudget.id, { amountCents: 777_777 });
      await voidExpense({ ...ctx, expenseId: gone.id, input: voidInput(1) });
      await add(ctx, plain.id, { amountCents: 50_000 });
      const other = await createTestCompany(prisma);
      const foreign = await createTestEvent(prisma, other.id);
      const outsider = await person(other.id, "OWNER");
      await add({ userId: outsider.id, companyId: other.id }, foreign.id, { amountCents: 1 });

      const { rows, truncated } = await listFinanceOverview(ctx);

      expect(truncated).toBe(false);
      expect(rows.map((r) => r.eventId).sort()).toEqual([withBudget.id, plain.id].sort());
      const budgeted = rows.find((r) => r.eventId === withBudget.id)!;
      expect(budgeted).toMatchObject({ plannedCents: 800_000, realizedCents: 400_000, expenseCount: 1 });
      expect(budgeted.revenue).toMatchObject({ kind: "ACCEPTED", cents: 1_050_000 });
      expect(budgeted.realizedMargin).toEqual({ marginCents: 650_000, marginBps: 6190 });
      const direct = rows.find((r) => r.eventId === plain.id)!;
      expect(direct).toMatchObject({ plannedCents: null, realizedCents: 50_000, revenue: null, realizedMargin: null });
    });

    it("evento sem lançamento aparece com zero", async () => {
      const { ctx, event } = await setup();

      const { rows } = await listFinanceOverview(ctx);

      expect(rows).toEqual([expect.objectContaining({ eventId: event.id, realizedCents: 0, expenseCount: 0, plannedCents: null })]);
    });
  });

  describe("histórico", () => {
    it("conta a história do lançamento em palavras, do mais novo ao mais antigo", async () => {
      const { ctx, event } = await setup();
      const created = await add(ctx, event.id, { description: "Buffet", category: "FOOD", amountCents: 500_000 });
      await updateExpense({ ...ctx, expenseId: created.id, input: updateInput(1, { description: "Buffet", category: "FOOD", amountCents: 450_000, notes: "Desconto" }) });
      await voidExpense({ ...ctx, expenseId: created.id, input: voidInput(2, "Cliente cancelou") });

      const { history } = await getEventFinance({ ...ctx, eventId: event.id });

      expect(history.map((h) => h.text)).toEqual([
        "Lançamento estornado: Buffet (R$ 4.500,00) — Cliente cancelou.",
        "Lançamento editado (Buffet): valor (de R$ 5.000,00 para R$ 4.500,00), observações.",
        "Lançamento criado: Buffet (Alimentação e bebidas, R$ 5.000,00).",
      ]);
    });
  });

  describe("concorrência (cada uma repetida em várias rodadas)", () => {
    const ROUNDS = 8;

    it("dois estornos ao mesmo tempo: um só vale, e o outro recebe 409 (sem duplicar)", async () => {
      for (let round = 0; round < ROUNDS; round++) {
        await truncateAll(prisma);
        const { ctx, event } = await setup();
        const created = await add(ctx, event.id);

        const results = await Promise.allSettled([
          voidExpense({ ...ctx, expenseId: created.id, input: voidInput(1, "primeiro") }),
          voidExpense({ ...ctx, expenseId: created.id, input: voidInput(1, "segundo") }),
        ]);

        expect(results.filter((r) => r.status === "fulfilled"), `rodada ${round}`).toHaveLength(1);
        for (const r of results.filter((r) => r.status === "rejected")) expect(r.reason).toEqual(adminError(409));
        expect(await prisma.auditLog.count({ where: { action: "EXPENSE_VOIDED" } }), `rodada ${round}`).toBe(1);
        expect((await prisma.eventExpense.findFirstOrThrow()).version, `rodada ${round}`).toBe(2);
      }
    });

    it("estornar × editar a mesma versão: só um vale, e o estado final é coerente", async () => {
      for (let round = 0; round < ROUNDS; round++) {
        await truncateAll(prisma);
        const { ctx, event } = await setup();
        const created = await add(ctx, event.id);

        const results = await Promise.allSettled([
          voidExpense({ ...ctx, expenseId: created.id, input: voidInput(1) }),
          updateExpense({ ...ctx, expenseId: created.id, input: updateInput(1, { amountCents: 42 }) }),
        ]);

        expect(results.filter((r) => r.status === "fulfilled"), `rodada ${round}`).toHaveLength(1);
        const stored = await prisma.eventExpense.findFirstOrThrow();
        expect(stored.version, `rodada ${round}`).toBe(2);
        // Estornado: com o valor ORIGINAL (a edição não entrou); editado: ativo com o valor novo. Nunca os dois.
        expect(stored.voidedAt !== null ? stored.amountCents === 300_000 : stored.amountCents === 42, `rodada ${round}`).toBe(true);
      }
    });

    it("duas edições da mesma versão: só uma vale, inteira", async () => {
      for (let round = 0; round < ROUNDS; round++) {
        await truncateAll(prisma);
        const { ctx, event } = await setup();
        const created = await add(ctx, event.id);

        const results = await Promise.allSettled([
          updateExpense({ ...ctx, expenseId: created.id, input: updateInput(1, { amountCents: 111, description: "Edição A" }) }),
          updateExpense({ ...ctx, expenseId: created.id, input: updateInput(1, { amountCents: 222, description: "Edição B" }) }),
        ]);

        expect(results.filter((r) => r.status === "fulfilled"), `rodada ${round}`).toHaveLength(1);
        const stored = await prisma.eventExpense.findFirstOrThrow();
        expect(stored.version, `rodada ${round}`).toBe(2);
        expect([`Edição A/111`, `Edição B/222`], `rodada ${round}`).toContain(`${stored.description}/${stored.amountCents}`);
      }
    });
  });
});
