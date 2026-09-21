import { prisma } from "@/lib/db/prisma";
import type { Budget, BudgetItem, Opportunity, Prisma } from "@/generated/prisma/client";
import {
  budgetProblems,
  computeBudgetTotals,
  computeMargin,
  explainBlockedBudgetEdit,
  pickRevenueReference,
  type Margin,
  type RevenueReference,
} from "@/lib/domain/budget";
import type { BudgetSaveInput } from "@/lib/domain/budget.schema";
import { AdminActionError } from "@/server/errors";
import { resolveSupplierLinks } from "@/server/suppliers/link";
import { lockOpportunity, requireBudget } from "./access";
import { toHistory } from "./history";

const HISTORY_LIMIT = 50;

const STALE_MESSAGE = "Este orçamento foi alterado por outra pessoa enquanto você editava. Recarregue para ver os dados atuais.";

export type BudgetWithItems = Budget & { items: BudgetItem[] };

const withItems = { items: { orderBy: { position: "asc" as const } } };

/** O que a auditoria guarda do orçamento (antes/depois), com os itens. */
function budgetSnapshot(budget: BudgetWithItems) {
  return {
    notes: budget.notes,
    items: [...budget.items]
      .sort((x, y) => x.position - y.position)
      .map((item) => ({
        category: item.category,
        description: item.description,
        quantity: item.quantity,
        unitCostCents: item.unitCostCents,
        supplier: item.supplier,
        supplierId: item.supplierId,
      })),
  };
}

/** Defesa em profundidade: os limites do schema também valem para quem chama o serviço direto. */
function assertBudget(items: ReadonlyArray<{ category: string; quantity: number; unitCostCents: number }>) {
  const problem = budgetProblems(items)[0];
  if (problem) throw new AdminActionError(problem.message, 422);
}

export interface BudgetView {
  opportunity: Pick<Opportunity, "id" | "title" | "stage" | "version" | "eventId" | "expectedValueCents">;
  client: { id: string; name: string };
  budget: BudgetWithItems | null;
  totals: ReturnType<typeof computeBudgetTotals>;
  /** Contra qual receita se calcula a margem (ou `null` se não há nenhuma). */
  revenue: RevenueReference | null;
  /** Receita − custo; `null` se não há orçamento com custo ou não há receita de referência. */
  margin: Margin | null;
  /** Por que não dá para editar agora (etapa/evento) — ou `null`. */
  blockedReason: string | null;
}

async function loadView(companyId: string, opportunityId: string): Promise<BudgetView> {
  const opportunity = await prisma.opportunity.findFirst({
    where: { id: opportunityId, companyId },
    include: { client: { select: { id: true, name: true } } },
  });
  if (!opportunity) throw new AdminActionError("Oportunidade não encontrada.", 404);

  const [budget, proposals] = await Promise.all([
    prisma.budget.findUnique({ where: { opportunityId: opportunity.id }, include: withItems }),
    prisma.proposal.findMany({ where: { opportunityId: opportunity.id, companyId }, select: { number: true, status: true, totalCents: true } }),
  ]);

  const totals = computeBudgetTotals(budget?.items ?? []);
  const revenue = pickRevenueReference(proposals, opportunity.expectedValueCents);
  const { client, ...fields } = opportunity;
  return {
    opportunity: { id: fields.id, title: fields.title, stage: fields.stage, version: fields.version, eventId: fields.eventId, expectedValueCents: fields.expectedValueCents },
    client,
    budget,
    totals,
    revenue,
    margin: budget && revenue ? computeMargin(revenue.cents, totals.totalCents) : null,
    blockedReason: explainBlockedBudgetEdit({ oppStage: fields.stage, hasEvent: fields.eventId !== null }),
  };
}

/** O resumo do orçamento de uma oportunidade (custo, receita de referência e margem), sem o histórico. */
export async function getBudgetSummary(params: { userId: string; companyId: string; opportunityId: string }): Promise<BudgetView> {
  await requireBudget(params.userId, params.companyId);
  return loadView(params.companyId, params.opportunityId);
}

/** O orçamento com o histórico em palavras. */
export async function getBudget(params: { userId: string; companyId: string; opportunityId: string }) {
  await requireBudget(params.userId, params.companyId);
  const view = await loadView(params.companyId, params.opportunityId);
  const audit = view.budget
    ? await prisma.auditLog.findMany({
        where: { companyId: params.companyId, entityType: "Budget", entityId: view.budget.id },
        orderBy: { createdAt: "desc" },
        take: HISTORY_LIMIT,
      })
    : [];
  return { ...view, history: await toHistory(audit) };
}

/**
 * Salva o orçamento da oportunidade: cria na primeira vez (`baseVersion` 0) e troca a lista INTEIRA
 * de itens depois. Sob a trava da oportunidade e com a versão que a pessoa via: dois "primeiros
 * salvamentos" ou duas edições da mesma versão nunca se sobrescrevem (a segunda recebe 409). Só
 * com a oportunidade em andamento ou ganha e ainda sem evento (`explainBlockedBudgetEdit`).
 */
export async function saveBudget(params: {
  userId: string;
  companyId: string;
  opportunityId: string;
  input: BudgetSaveInput;
}): Promise<BudgetWithItems> {
  await requireBudget(params.userId, params.companyId);
  const { items, notes, baseVersion } = params.input;
  assertBudget(items);

  return prisma.$transaction(async (tx) => {
    const found = await tx.opportunity.findFirst({ where: { id: params.opportunityId, companyId: params.companyId }, select: { id: true } });
    if (!found) throw new AdminActionError("Oportunidade não encontrada.", 404);
    await lockOpportunity(tx, found.id);
    const opportunity = await tx.opportunity.findUniqueOrThrow({ where: { id: found.id } });

    const blocked = explainBlockedBudgetEdit({ oppStage: opportunity.stage, hasEvent: opportunity.eventId !== null });
    if (blocked) throw new AdminActionError(blocked, 409);

    const current = await tx.budget.findUnique({ where: { opportunityId: opportunity.id }, include: withItems });
    // Sem orçamento a "versão" é 0: quem abriu a tela vazia e chega depois de outra pessoa criar recebe 409.
    if ((current?.version ?? 0) !== baseVersion) throw new AdminActionError(STALE_MESSAGE, 409);

    // Fornecedores do cadastro: da empresa, e sem vínculo NOVO com arquivado (o que já estava vinculado segue valendo).
    const alreadyLinked = new Set((current?.items ?? []).map((item) => item.supplierId).filter((id): id is string => id !== null));
    const names = await resolveSupplierLinks(tx, params.companyId, items.map((item) => item.supplierId), alreadyLinked);
    const rows = items.map((item, position) => ({
      position,
      category: item.category,
      description: item.description,
      quantity: item.quantity,
      unitCostCents: item.unitCostCents,
      supplierId: item.supplierId ?? null,
      // Com vínculo, o nome é o do cadastro (o texto livre é ignorado); sem vínculo, vale o texto.
      supplier: item.supplierId ? (names.get(item.supplierId) ?? null) : (item.supplier ?? null),
    }));
    const log = (action: string, before: Prisma.InputJsonValue | undefined, saved: BudgetWithItems) =>
      tx.auditLog.create({
        data: {
          companyId: params.companyId,
          userId: params.userId,
          entityType: "Budget",
          entityId: saved.id,
          action,
          beforeJson: before,
          afterJson: budgetSnapshot(saved),
          metadata: { opportunityId: opportunity.id },
        },
      });

    if (!current) {
      const created = await tx.budget.create({
        data: {
          companyId: params.companyId,
          opportunityId: opportunity.id,
          notes,
          createdBy: params.userId,
          updatedBy: params.userId,
          items: { create: rows },
        },
        include: withItems,
      });
      await log("BUDGET_CREATED", undefined, created);
      return created;
    }

    await tx.budgetItem.deleteMany({ where: { budgetId: current.id } });
    const updated = await tx.budget.update({
      where: { id: current.id },
      data: { notes, updatedBy: params.userId, version: { increment: 1 }, items: { create: rows } },
      include: withItems,
    });
    await log("BUDGET_UPDATED", budgetSnapshot(current), updated);
    return updated;
  });
}
