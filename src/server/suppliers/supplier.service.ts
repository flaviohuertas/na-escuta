import { prisma } from "@/lib/db/prisma";
import { Prisma, type Supplier } from "@/generated/prisma/client";
import { formatDocument, onlyDigits } from "@/lib/domain/crm";
import { summarizeSpend, type SpendGroup } from "@/lib/domain/supplier";
import type { SupplierInput, SupplierUpdateInput } from "@/lib/domain/supplier.schema";
import { AdminActionError } from "@/server/errors";
import { requireFinance } from "@/server/finance/access";
import { toHistory } from "@/server/crm/history";
import { lockSupplier, requireSuppliers } from "./access";

const LIST_LIMIT = 200;
const OPTIONS_LIMIT = 500;
const HISTORY_LIMIT = 50;

const STALE_MESSAGE = "Este fornecedor foi alterado por outra pessoa enquanto você olhava. Recarregue para ver os dados atuais.";

/** O que a auditoria guarda do fornecedor (antes/depois). */
function snapshot(supplier: Supplier) {
  return {
    name: supplier.name,
    kind: supplier.kind,
    document: supplier.document,
    contactName: supplier.contactName,
    email: supplier.email,
    phone: supplier.phone,
    category: supplier.category,
    notes: supplier.notes,
    archived: supplier.archivedAt !== null,
  };
}

/** Mensagem de "documento já cadastrado", dizendo QUEM é (e se está arquivado) para a pessoa achar o cadastro certo. */
async function duplicateDocumentError(companyId: string, document: string): Promise<AdminActionError> {
  const existing = await prisma.supplier.findFirst({ where: { companyId, document }, select: { name: true, archivedAt: true } });
  const who = existing ? `${existing.name}${existing.archivedAt ? " (arquivado — reative-o em vez de cadastrar de novo)" : ""}` : "outro fornecedor";
  return new AdminActionError(`O documento ${formatDocument(document)} já está cadastrado para ${who}.`, 409);
}

async function loadSupplier(companyId: string, supplierId: string): Promise<Supplier> {
  const supplier = await prisma.supplier.findFirst({ where: { id: supplierId, companyId } });
  if (!supplier) throw new AdminActionError("Fornecedor não encontrado.", 404);
  return supplier;
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

export interface SupplierListRow {
  id: string;
  name: string;
  kind: "COMPANY" | "PERSON";
  document: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  category: string | null;
  archived: boolean;
}

/**
 * Os fornecedores da empresa, por nome. `search` procura no nome, no contato, no e-mail e no
 * documento (com ou sem máscara); `category` filtra pela categoria principal. Arquivados só
 * aparecem se pedidos. No máximo 200: a tela mostra que há mais.
 */
export async function listSuppliers(params: {
  userId: string;
  companyId: string;
  search?: string;
  category?: string;
  includeArchived?: boolean;
}): Promise<{ rows: SupplierListRow[]; truncated: boolean }> {
  await requireSuppliers(params.userId, params.companyId);

  const term = params.search?.trim();
  const digits = term ? onlyDigits(term) : "";
  const where: Prisma.SupplierWhereInput = {
    companyId: params.companyId,
    ...(params.includeArchived ? {} : { archivedAt: null }),
    ...(params.category ? { category: params.category } : {}),
    ...(term
      ? {
          OR: [
            { name: { contains: term, mode: "insensitive" } },
            { contactName: { contains: term, mode: "insensitive" } },
            { email: { contains: term, mode: "insensitive" } },
            ...(digits.length >= 3 ? [{ document: { contains: digits } }] : []),
          ],
        }
      : {}),
  };

  const rows = await prisma.supplier.findMany({ where, orderBy: { name: "asc" }, take: LIST_LIMIT + 1 });
  return {
    truncated: rows.length > LIST_LIMIT,
    rows: rows.slice(0, LIST_LIMIT).map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.kind,
      document: s.document,
      contactName: s.contactName,
      email: s.email,
      phone: s.phone,
      category: s.category,
      archived: s.archivedAt !== null,
    })),
  };
}

export interface SupplierOption {
  id: string;
  name: string;
  archived: boolean;
}

/**
 * Os fornecedores para escolher num item de orçamento ou lançamento: os ATIVOS (por nome) e, se
 * pedidos em `alsoIds`, os que o registro já cita mesmo arquivados (para a tela mostrar o vínculo
 * que existe em vez de perdê-lo ao editar).
 */
export async function listSupplierOptions(params: { userId: string; companyId: string; alsoIds?: readonly string[] }): Promise<SupplierOption[]> {
  await requireSuppliers(params.userId, params.companyId);
  const alsoIds = [...new Set(params.alsoIds ?? [])];

  const rows = await prisma.supplier.findMany({
    where: { companyId: params.companyId, OR: [{ archivedAt: null }, ...(alsoIds.length > 0 ? [{ id: { in: alsoIds } }] : [])] },
    select: { id: true, name: true, archivedAt: true },
    orderBy: { name: "asc" },
    take: OPTIONS_LIMIT,
  });
  return rows.map((row) => ({ id: row.id, name: row.name, archived: row.archivedAt !== null }));
}

/** Um fornecedor com o histórico em palavras. */
export async function getSupplier(params: { userId: string; companyId: string; supplierId: string }) {
  await requireSuppliers(params.userId, params.companyId);
  const supplier = await loadSupplier(params.companyId, params.supplierId);
  const audit = await prisma.auditLog.findMany({
    where: { companyId: params.companyId, entityType: "Supplier", entityId: supplier.id },
    orderBy: { createdAt: "desc" },
    take: HISTORY_LIMIT,
  });
  return { supplier, history: await toHistory(audit) };
}

/**
 * O DINHEIRO de um fornecedor: quanto se gastou (lançamentos ativos, por evento) e quanto se orçou
 * (itens de orçamento, por oportunidade). É do financeiro — só quem vê o financeiro
 * (`requireFinance`: titular e administração) — e NÃO do cadastro: a produção mantém o cadastro sem
 * ver um centavo disto.
 */
export async function getSupplierSpend(params: { userId: string; companyId: string; supplierId: string }) {
  await requireFinance(params.userId, params.companyId);
  const supplier = await loadSupplier(params.companyId, params.supplierId);

  const [expenseSums, budgetItems] = await Promise.all([
    prisma.eventExpense.groupBy({
      by: ["eventId"],
      where: { companyId: params.companyId, supplierId: supplier.id, voidedAt: null },
      _sum: { amountCents: true },
      _count: { _all: true },
    }),
    prisma.budgetItem.findMany({
      where: { supplierId: supplier.id, budget: { companyId: params.companyId } },
      select: {
        quantity: true,
        unitCostCents: true,
        budget: { select: { opportunityId: true, opportunity: { select: { title: true } } } },
      },
    }),
  ]);

  const events = expenseSums.length
    ? await prisma.event.findMany({ where: { id: { in: expenseSums.map((s) => s.eventId) }, companyId: params.companyId }, select: { id: true, name: true } })
    : [];
  const realized: SpendGroup[] = expenseSums
    .map((sum) => ({ id: sum.eventId, name: events.find((e) => e.id === sum.eventId)?.name ?? "Evento", totalCents: sum._sum.amountCents ?? 0, count: sum._count._all }))
    .sort((a, b) => b.totalCents - a.totalCents);

  const byOpportunity = new Map<string, SpendGroup>();
  for (const item of budgetItems) {
    const id = item.budget.opportunityId;
    const group = byOpportunity.get(id) ?? { id, name: item.budget.opportunity.title, totalCents: 0, count: 0 };
    group.totalCents += item.quantity * item.unitCostCents;
    group.count += 1;
    byOpportunity.set(id, group);
  }
  const planned = [...byOpportunity.values()].sort((a, b) => b.totalCents - a.totalCents);

  return { realized, planned, summary: summarizeSpend(realized, planned) };
}

// ---------------------------------------------------------------------------
// Escrita
// ---------------------------------------------------------------------------

export async function createSupplier(params: { userId: string; companyId: string; input: SupplierInput }): Promise<Supplier> {
  await requireSuppliers(params.userId, params.companyId);

  try {
    return await prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.create({
        data: { ...params.input, companyId: params.companyId, createdBy: params.userId, updatedBy: params.userId },
      });
      await tx.auditLog.create({
        data: {
          companyId: params.companyId,
          userId: params.userId,
          entityType: "Supplier",
          entityId: supplier.id,
          action: "SUPPLIER_CREATED",
          afterJson: snapshot(supplier),
        },
      });
      return supplier;
    });
  } catch (err) {
    // Dois cadastros do mesmo documento: a chave única é quem decide, sem corrida.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002" && params.input.document) {
      throw await duplicateDocumentError(params.companyId, params.input.document);
    }
    throw err;
  }
}

/**
 * Edita o cadastro, com a versão que a pessoa via (senão 409). Arquivado não se edita (reative
 * antes). Se o NOME mudou, o nome guardado nos itens de orçamento e lançamentos ligados a este
 * fornecedor acompanha, na mesma transação — o vínculo é pelo id, o nome é só o que se lê. A
 * auditoria diz em quantos registros o nome foi atualizado.
 */
export async function updateSupplier(params: {
  userId: string;
  companyId: string;
  supplierId: string;
  input: SupplierUpdateInput;
}): Promise<Supplier> {
  await requireSuppliers(params.userId, params.companyId);
  const { baseVersion, ...fields } = params.input;

  try {
    return await prisma.$transaction(async (tx) => {
      const current = await tx.supplier.findFirst({ where: { id: params.supplierId, companyId: params.companyId } });
      if (!current) throw new AdminActionError("Fornecedor não encontrado.", 404);
      if (current.archivedAt) throw new AdminActionError("Este fornecedor está arquivado. Reative-o para editar.", 409);

      const written = await tx.supplier.updateMany({
        where: { id: current.id, companyId: params.companyId, version: baseVersion, archivedAt: null },
        data: { ...fields, updatedBy: params.userId, version: { increment: 1 } },
      });
      if (written.count === 0) throw new AdminActionError(STALE_MESSAGE, 409);

      const updated = await tx.supplier.findUniqueOrThrow({ where: { id: current.id } });
      let renamedBudgetItems = 0;
      let renamedExpenses = 0;
      if (updated.name !== current.name) {
        renamedBudgetItems = (await tx.budgetItem.updateMany({ where: { supplierId: current.id }, data: { supplier: updated.name } })).count;
        renamedExpenses = (await tx.eventExpense.updateMany({ where: { supplierId: current.id, companyId: params.companyId }, data: { supplier: updated.name } })).count;
      }

      await tx.auditLog.create({
        data: {
          companyId: params.companyId,
          userId: params.userId,
          entityType: "Supplier",
          entityId: current.id,
          action: "SUPPLIER_UPDATED",
          beforeJson: snapshot(current),
          afterJson: snapshot(updated),
          metadata: { renamedBudgetItems, renamedExpenses },
        },
      });
      return updated;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002" && fields.document) {
      throw await duplicateDocumentError(params.companyId, fields.document);
    }
    throw err;
  }
}

/**
 * Arquiva ou reativa um fornecedor (ele nunca é apagado: os orçamentos e lançamentos que o citam
 * seguem legíveis). Com a linha travada: arquivar ao mesmo tempo em que alguém o vincula nunca
 * deixa um vínculo novo com um arquivado (veja `resolveSupplierLinks`). Arquivar não desfaz os
 * vínculos que já existem.
 */
export async function setSupplierArchived(params: {
  userId: string;
  companyId: string;
  supplierId: string;
  archived: boolean;
  baseVersion: number;
}): Promise<Supplier> {
  await requireSuppliers(params.userId, params.companyId);

  return prisma.$transaction(async (tx) => {
    await lockSupplier(tx, params.supplierId);
    const current = await tx.supplier.findFirst({ where: { id: params.supplierId, companyId: params.companyId } });
    if (!current) throw new AdminActionError("Fornecedor não encontrado.", 404);
    if (current.version !== params.baseVersion) throw new AdminActionError(STALE_MESSAGE, 409);
    if (params.archived === (current.archivedAt !== null)) {
      throw new AdminActionError(params.archived ? "Este fornecedor já está arquivado." : "Este fornecedor não está arquivado.", 409);
    }

    const updated = await tx.supplier.update({
      where: { id: current.id },
      data: { archivedAt: params.archived ? new Date() : null, updatedBy: params.userId, version: { increment: 1 } },
    });
    await tx.auditLog.create({
      data: {
        companyId: params.companyId,
        userId: params.userId,
        entityType: "Supplier",
        entityId: current.id,
        action: params.archived ? "SUPPLIER_ARCHIVED" : "SUPPLIER_RESTORED",
        beforeJson: snapshot(current),
        afterJson: snapshot(updated),
      },
    });
    return updated;
  });
}
