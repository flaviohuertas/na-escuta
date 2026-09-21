import { prisma } from "@/lib/db/prisma";
import type { EventExpense, Prisma } from "@/generated/prisma/client";
import { computeBudgetTotals, computeMargin, pickRevenueReference, type Margin, type RevenueReference } from "@/lib/domain/budget";
import { compareToBudget } from "@/lib/domain/finance";
import type { ExpenseInput, ExpenseUpdateInput, ExpenseVoidInput } from "@/lib/domain/finance.schema";
import { dateOnlyFromDate, dateOnlyToDate, todayInSaoPaulo } from "@/lib/domain/proposal";
import { AdminActionError } from "@/server/errors";
import { toHistory } from "@/server/crm/history";
import { requireFinance } from "./access";

const LIST_LIMIT = 200;
const EXPENSE_LIMIT = 500;
const HISTORY_LIMIT = 50;

const STALE_MESSAGE = "Este lançamento foi alterado por outra pessoa enquanto você olhava. Recarregue para ver os dados atuais.";
const VOIDED_MESSAGE = "Este lançamento foi estornado e não pode mais ser alterado.";

/** O que a auditoria guarda do lançamento (antes/depois). */
function expenseSnapshot(expense: EventExpense) {
  return {
    category: expense.category,
    description: expense.description,
    supplier: expense.supplier,
    amountCents: expense.amountCents,
    expenseDate: dateOnlyFromDate(expense.expenseDate),
    notes: expense.notes,
  };
}

async function loadEvent(companyId: string, eventId: string) {
  const event = await prisma.event.findFirst({ where: { id: eventId, companyId, deletedAt: null } });
  if (!event) throw new AdminActionError("Evento não encontrado.", 404);
  return event;
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

export interface FinanceOverviewRow {
  eventId: string;
  name: string;
  status: string;
  startDate: Date;
  endDate: Date;
  /** O custo previsto (orçamento da oportunidade de origem), ou `null` se não há orçamento. */
  plannedCents: number | null;
  /** A soma dos lançamentos ATIVOS (estornados não contam). */
  realizedCents: number;
  expenseCount: number;
  /** A receita de referência (proposta aceita > enviada > rascunho > estimativa) — só se o evento nasceu de uma oportunidade. */
  revenue: RevenueReference | null;
  /** Receita − custo lançado até agora (parcial enquanto o evento gasta); `null` sem receita. */
  realizedMargin: Margin | null;
}

/**
 * Os eventos da empresa com o custo previsto, o realizado e a margem até agora. No máximo 200 (os
 * mais recentes primeiro); a tela avisa quando há mais.
 */
export async function listFinanceOverview(params: {
  userId: string;
  companyId: string;
}): Promise<{ rows: FinanceOverviewRow[]; truncated: boolean }> {
  await requireFinance(params.userId, params.companyId);

  const events = await prisma.event.findMany({
    where: { companyId: params.companyId, deletedAt: null },
    orderBy: { startDate: "desc" },
    take: LIST_LIMIT + 1,
  });
  const shown = events.slice(0, LIST_LIMIT);
  const ids = shown.map((event) => event.id);

  const [sums, opportunities] = await Promise.all([
    prisma.eventExpense.groupBy({
      by: ["eventId"],
      where: { companyId: params.companyId, eventId: { in: ids }, voidedAt: null },
      _sum: { amountCents: true },
      _count: { _all: true },
    }),
    prisma.opportunity.findMany({
      where: { companyId: params.companyId, eventId: { in: ids } },
      select: {
        eventId: true,
        expectedValueCents: true,
        budget: { select: { items: { select: { category: true, quantity: true, unitCostCents: true } } } },
        proposals: { select: { number: true, status: true, totalCents: true } },
      },
    }),
  ]);

  const rows = shown.map((event): FinanceOverviewRow => {
    const sum = sums.find((s) => s.eventId === event.id);
    const opportunity = opportunities.find((o) => o.eventId === event.id);
    const realizedCents = sum?._sum.amountCents ?? 0;
    const revenue = opportunity ? pickRevenueReference(opportunity.proposals, opportunity.expectedValueCents) : null;
    return {
      eventId: event.id,
      name: event.name,
      status: event.status,
      startDate: event.startDate,
      endDate: event.endDate,
      plannedCents: opportunity?.budget ? computeBudgetTotals(opportunity.budget.items).totalCents : null,
      realizedCents,
      expenseCount: sum?._count._all ?? 0,
      revenue,
      realizedMargin: revenue ? computeMargin(revenue.cents, realizedCents) : null,
    };
  });
  return { rows, truncated: events.length > LIST_LIMIT };
}

/**
 * O financeiro de UM evento: os lançamentos (os estornados aparecem, marcados, e não contam), a
 * comparação com o orçamento previsto por categoria, a receita de referência e as margens prevista
 * e realizada. O orçamento e a receita vêm da oportunidade de onde o evento nasceu; um evento
 * criado direto (sem oportunidade) só tem o realizado.
 */
export async function getEventFinance(params: { userId: string; companyId: string; eventId: string; now?: Date }) {
  await requireFinance(params.userId, params.companyId);
  const event = await loadEvent(params.companyId, params.eventId);

  const [expenses, realizedByCategory, opportunity, audit] = await Promise.all([
    prisma.eventExpense.findMany({
      where: { eventId: event.id, companyId: params.companyId },
      orderBy: [{ expenseDate: "desc" }, { createdAt: "desc" }],
      take: EXPENSE_LIMIT + 1,
    }),
    prisma.eventExpense.groupBy({
      by: ["category"],
      where: { eventId: event.id, companyId: params.companyId, voidedAt: null },
      _sum: { amountCents: true },
    }),
    prisma.opportunity.findFirst({
      where: { eventId: event.id, companyId: params.companyId },
      include: {
        client: { select: { name: true } },
        budget: { include: { items: { orderBy: { position: "asc" } } } },
        proposals: { select: { number: true, status: true, totalCents: true } },
      },
    }),
    prisma.auditLog.findMany({
      where: { companyId: params.companyId, eventId: event.id, entityType: "EventExpense" },
      orderBy: { createdAt: "desc" },
      take: HISTORY_LIMIT,
    }),
  ]);

  const plannedTotals = computeBudgetTotals(opportunity?.budget?.items ?? []);
  const comparison = compareToBudget(
    plannedTotals.byCategory,
    realizedByCategory.map((row) => ({ category: row.category, totalCents: row._sum.amountCents ?? 0 }))
  );
  const revenue = opportunity ? pickRevenueReference(opportunity.proposals, opportunity.expectedValueCents) : null;

  return {
    event,
    opportunity: opportunity ? { id: opportunity.id, title: opportunity.title, clientName: opportunity.client.name } : null,
    expenses: expenses.slice(0, EXPENSE_LIMIT),
    truncated: expenses.length > EXPENSE_LIMIT,
    comparison,
    revenue,
    /** Receita − custo PREVISTO (só com orçamento e receita). */
    plannedMargin: revenue && comparison.hasBudget ? computeMargin(revenue.cents, comparison.plannedTotalCents) : null,
    /** Receita − custo lançado até agora (só com receita). */
    realizedMargin: revenue ? computeMargin(revenue.cents, comparison.realizedTotalCents) : null,
    history: await toHistory(audit),
    /** O dia de hoje em Brasília, para a data padrão do formulário. */
    today: todayInSaoPaulo(params.now),
  };
}

/** Um lançamento (para a tela de edição), com o evento ao qual pertence. */
export async function getExpense(params: { userId: string; companyId: string; expenseId: string }) {
  await requireFinance(params.userId, params.companyId);
  const expense = await prisma.eventExpense.findFirst({ where: { id: params.expenseId, companyId: params.companyId } });
  if (!expense) throw new AdminActionError("Lançamento não encontrado.", 404);
  const event = await loadEvent(params.companyId, expense.eventId);
  return { expense, event };
}

// ---------------------------------------------------------------------------
// Escrita
// ---------------------------------------------------------------------------

/** Lança um custo realizado no evento. A qualquer momento (custos aparecem até depois do evento acabar ou ser cancelado). */
export async function createExpense(params: { userId: string; companyId: string; eventId: string; input: ExpenseInput }): Promise<EventExpense> {
  await requireFinance(params.userId, params.companyId);
  const { input } = params;

  return prisma.$transaction(async (tx) => {
    const event = await tx.event.findFirst({ where: { id: params.eventId, companyId: params.companyId, deletedAt: null }, select: { id: true } });
    if (!event) throw new AdminActionError("Evento não encontrado.", 404);

    const created = await tx.eventExpense.create({
      data: {
        companyId: params.companyId,
        eventId: event.id,
        category: input.category,
        description: input.description,
        supplier: input.supplier,
        amountCents: input.amountCents,
        expenseDate: dateOnlyToDate(input.expenseDate),
        notes: input.notes,
        createdBy: params.userId,
        updatedBy: params.userId,
      },
    });
    await tx.auditLog.create({
      data: {
        companyId: params.companyId,
        eventId: event.id,
        userId: params.userId,
        entityType: "EventExpense",
        entityId: created.id,
        action: "EXPENSE_CREATED",
        afterJson: expenseSnapshot(created),
      },
    });
    return created;
  });
}

/**
 * Se a escrita condicional não acertou nenhuma linha, diz por quê: o lançamento sumiu/é de outra
 * empresa (404), já foi estornado (409) ou outra pessoa mexeu antes (409, versão velha).
 */
async function explainNoWrite(tx: Prisma.TransactionClient, companyId: string, expenseId: string): Promise<never> {
  const current = await tx.eventExpense.findFirst({ where: { id: expenseId, companyId } });
  if (!current) throw new AdminActionError("Lançamento não encontrado.", 404);
  throw new AdminActionError(current.voidedAt ? VOIDED_MESSAGE : STALE_MESSAGE, 409);
}

/**
 * Edita um lançamento ATIVO com a versão que a pessoa via. A escrita é uma só, condicional
 * (`version` E não estornado): dois "salvar" da mesma versão ou um "salvar" que chega depois de um
 * "estornar" nunca se sobrescrevem — o segundo recebe 409.
 */
export async function updateExpense(params: {
  userId: string;
  companyId: string;
  expenseId: string;
  input: ExpenseUpdateInput;
}): Promise<EventExpense> {
  await requireFinance(params.userId, params.companyId);
  const { baseVersion, ...fields } = params.input;

  return prisma.$transaction(async (tx) => {
    const current = await tx.eventExpense.findFirst({ where: { id: params.expenseId, companyId: params.companyId } });
    if (!current) throw new AdminActionError("Lançamento não encontrado.", 404);
    if (current.voidedAt) throw new AdminActionError(VOIDED_MESSAGE, 409);

    const written = await tx.eventExpense.updateMany({
      where: { id: current.id, companyId: params.companyId, version: baseVersion, voidedAt: null },
      data: {
        category: fields.category,
        description: fields.description,
        supplier: fields.supplier,
        amountCents: fields.amountCents,
        expenseDate: dateOnlyToDate(fields.expenseDate),
        notes: fields.notes,
        updatedBy: params.userId,
        version: { increment: 1 },
      },
    });
    if (written.count === 0) return explainNoWrite(tx, params.companyId, current.id);

    const updated = await tx.eventExpense.findUniqueOrThrow({ where: { id: current.id } });
    await tx.auditLog.create({
      data: {
        companyId: params.companyId,
        eventId: current.eventId,
        userId: params.userId,
        entityType: "EventExpense",
        entityId: current.id,
        action: "EXPENSE_UPDATED",
        beforeJson: expenseSnapshot(current),
        afterJson: expenseSnapshot(updated),
      },
    });
    return updated;
  });
}

/**
 * Estorna um lançamento (nunca se apaga dinheiro): ele fica na lista, riscado, com quem estornou e
 * o motivo, e sai dos totais. Escrita condicional pela versão e por "ainda não estornado": dois
 * estornos ao mesmo tempo, ou um estorno que chega depois de uma edição, nunca duplicam nem se
 * sobrescrevem — só um vale, o outro recebe 409.
 */
export async function voidExpense(params: {
  userId: string;
  companyId: string;
  expenseId: string;
  input: ExpenseVoidInput;
}): Promise<EventExpense> {
  await requireFinance(params.userId, params.companyId);
  const { reason, baseVersion } = params.input;

  return prisma.$transaction(async (tx) => {
    const current = await tx.eventExpense.findFirst({ where: { id: params.expenseId, companyId: params.companyId } });
    if (!current) throw new AdminActionError("Lançamento não encontrado.", 404);
    if (current.voidedAt) throw new AdminActionError(VOIDED_MESSAGE, 409);

    const written = await tx.eventExpense.updateMany({
      where: { id: current.id, companyId: params.companyId, version: baseVersion, voidedAt: null },
      data: { voidedAt: new Date(), voidedBy: params.userId, voidReason: reason, updatedBy: params.userId, version: { increment: 1 } },
    });
    if (written.count === 0) return explainNoWrite(tx, params.companyId, current.id);

    const voided = await tx.eventExpense.findUniqueOrThrow({ where: { id: current.id } });
    await tx.auditLog.create({
      data: {
        companyId: params.companyId,
        eventId: current.eventId,
        userId: params.userId,
        entityType: "EventExpense",
        entityId: current.id,
        action: "EXPENSE_VOIDED",
        beforeJson: expenseSnapshot(current),
        afterJson: expenseSnapshot(voided),
        metadata: { reason },
      },
    });
    return voided;
  });
}
