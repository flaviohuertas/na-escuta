import { prisma } from "@/lib/db/prisma";
import type { Opportunity, Prisma, Proposal, ProposalItem } from "@/generated/prisma/client";
import { OpportunityStage, ProposalStatus } from "@/generated/prisma/enums";
import { isOpenStage } from "@/lib/domain/crm";
import {
  computeTotals,
  dateOnlyFromDate,
  dateOnlyToDate,
  explainBlockedProposalAction,
  explainBlockedProposalCreate,
  isExpired,
  stageAfterSend,
  todayInSaoPaulo,
  totalsProblems,
  type ProposalContext,
  type ProposalStatusName,
} from "@/lib/domain/proposal";
import type { ProposalActionInput, ProposalInput, ProposalUpdateInput } from "@/lib/domain/proposal.schema";
import { AdminActionError } from "@/server/errors";
import { lockOpportunity, requireCrm } from "./access";
import { toHistory } from "./history";
import { opportunitySnapshot } from "./opportunity.service";

const LIST_LIMIT = 200;
const HISTORY_LIMIT = 50;

const STALE_MESSAGE = "Esta proposta foi alterada por outra pessoa enquanto você olhava. Recarregue para ver os dados atuais.";

export type ProposalWithItems = Proposal & { items: ProposalItem[] };

const withItems = { items: { orderBy: { position: "asc" as const } } };

/** O que a auditoria guarda da proposta (antes/depois), com os itens. */
function proposalSnapshot(p: ProposalWithItems) {
  return {
    number: p.number,
    status: p.status,
    validUntil: p.validUntil ? dateOnlyFromDate(p.validUntil) : null,
    notes: p.notes,
    discountCents: p.discountCents,
    subtotalCents: p.subtotalCents,
    totalCents: p.totalCents,
    items: [...p.items]
      .sort((x, y) => x.position - y.position)
      .map((item) => ({ description: item.description, quantity: item.quantity, unitPriceCents: item.unitPriceCents })),
  };
}

/**
 * Grava a auditoria numa transação. Cada linha leva um instante 1 ms depois da anterior: dentro de
 * uma transação o relógio do banco é o mesmo, e sem isto o histórico (do mais novo ao mais antigo)
 * poderia trocar a ordem do que aconteceu junto — "enviada" antes de "substituída", por exemplo.
 */
function auditWriter(tx: Prisma.TransactionClient, who: { companyId: string; userId: string }) {
  const base = Date.now();
  let sequence = 0;
  return (entry: {
    entityType: "Proposal" | "Opportunity";
    entityId: string;
    action: string;
    before?: Prisma.InputJsonValue;
    after?: Prisma.InputJsonValue;
    metadata?: Prisma.InputJsonValue;
  }) =>
    tx.auditLog.create({
      data: {
        companyId: who.companyId,
        userId: who.userId,
        entityType: entry.entityType,
        entityId: entry.entityId,
        action: entry.action,
        beforeJson: entry.before,
        afterJson: entry.after,
        metadata: entry.metadata,
        createdAt: new Date(base + sequence++),
      },
    });
}

/** Defesa em profundidade: os limites do schema também valem para quem chama o serviço direto. */
function assertTotals(items: ReadonlyArray<{ quantity: number; unitPriceCents: number }>, discountCents: number) {
  const problem = totalsProblems(items, discountCents)[0];
  if (problem) throw new AdminActionError(problem.message, 422);
}

const validUntilOf = (p: Pick<Proposal, "validUntil">): string | null => (p.validUntil ? dateOnlyFromDate(p.validUntil) : null);

function contextOf(proposal: ProposalWithItems, opportunity: Opportunity, today: string): ProposalContext {
  return {
    status: proposal.status,
    oppStage: opportunity.stage,
    hasEvent: opportunity.eventId !== null,
    validUntil: validUntilOf(proposal),
    today,
    itemCount: proposal.items.length,
    totalCents: proposal.totalCents,
  };
}

async function loadOpportunity(companyId: string, opportunityId: string): Promise<Opportunity> {
  const found = await prisma.opportunity.findFirst({ where: { id: opportunityId, companyId } });
  if (!found) throw new AdminActionError("Oportunidade não encontrada.", 404);
  return found;
}

/**
 * Trava a oportunidade da proposta (`FOR UPDATE`) e relê tudo DEPOIS da trava. Toda mudança de
 * proposta passa por aqui: é o que garante "no máximo um rascunho e uma enviada por oportunidade"
 * e que aceitar/enviar/editar ao mesmo tempo se enfileirem em vez de se atropelarem.
 */
async function lockForProposal(tx: Prisma.TransactionClient, companyId: string, proposalId: string) {
  const found = await tx.proposal.findFirst({ where: { id: proposalId, companyId }, select: { opportunityId: true } });
  if (!found) throw new AdminActionError("Proposta não encontrada.", 404);
  await lockOpportunity(tx, found.opportunityId);

  // Depois da trava o que se viu antes pode ter mudado — inclusive a proposta ter sido descartada.
  const proposal = await tx.proposal.findFirst({ where: { id: proposalId, companyId }, include: withItems });
  if (!proposal) throw new AdminActionError("Proposta não encontrada.", 404);
  const opportunity = await tx.opportunity.findUniqueOrThrow({ where: { id: proposal.opportunityId } });
  return { proposal, opportunity };
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

export interface ProposalRow {
  id: string;
  number: number;
  status: ProposalStatusName;
  totalCents: number;
  validUntil: string | null;
  sentAt: Date | null;
  itemCount: number;
  /** Enviada e com a validade vencida (só faz sentido para as enviadas). */
  expired: boolean;
}

const toRow = (p: Proposal & { _count: { items: number } }, today: string): ProposalRow => ({
  id: p.id,
  number: p.number,
  status: p.status,
  totalCents: p.totalCents,
  validUntil: validUntilOf(p),
  sentAt: p.sentAt,
  itemCount: p._count.items,
  expired: p.status === ProposalStatus.SENT && isExpired(validUntilOf(p), today),
});

/** As versões das propostas de uma oportunidade (da mais nova à mais antiga). */
export async function listOpportunityProposals(params: { userId: string; companyId: string; opportunityId: string; now?: Date }) {
  await requireCrm(params.userId, params.companyId);
  const opportunity = await loadOpportunity(params.companyId, params.opportunityId);
  const today = todayInSaoPaulo(params.now);
  const rows = await prisma.proposal.findMany({
    where: { opportunityId: opportunity.id, companyId: params.companyId },
    orderBy: { number: "desc" },
    include: { _count: { select: { items: true } } },
  });
  const draft = rows.find((row) => row.status === ProposalStatus.DRAFT) ?? null;
  return {
    rows: rows.map((row) => toRow(row, today)),
    draftId: draft?.id ?? null,
    /** Por que não dá para criar proposta agora (etapa/evento) — ou `null`. Um rascunho existente é tratado à parte. */
    createBlockedReason: explainBlockedProposalCreate({ oppStage: opportunity.stage, hasEvent: opportunity.eventId !== null }),
  };
}

export interface ProposalOverviewRow extends ProposalRow {
  opportunityId: string;
  opportunityTitle: string;
  clientName: string;
}

/**
 * As propostas da empresa, com a oportunidade e o cliente. As ENVIADAS vêm por validade (as que
 * vencem primeiro no topo) — é a lista de quem está esperando resposta. No máximo 200.
 */
export async function listProposals(params: {
  userId: string;
  companyId: string;
  status?: ProposalStatusName;
  now?: Date;
}): Promise<{ rows: ProposalOverviewRow[]; truncated: boolean }> {
  await requireCrm(params.userId, params.companyId);
  const today = todayInSaoPaulo(params.now);
  const rows = await prisma.proposal.findMany({
    where: { companyId: params.companyId, ...(params.status ? { status: params.status } : {}) },
    orderBy:
      params.status === ProposalStatus.SENT
        ? [{ validUntil: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }]
        : [{ updatedAt: "desc" }],
    take: LIST_LIMIT + 1,
    include: {
      _count: { select: { items: true } },
      opportunity: { select: { id: true, title: true, client: { select: { name: true } } } },
    },
  });
  return {
    truncated: rows.length > LIST_LIMIT,
    rows: rows.slice(0, LIST_LIMIT).map((row) => ({
      ...toRow(row, today),
      opportunityId: row.opportunity.id,
      opportunityTitle: row.opportunity.title,
      clientName: row.opportunity.client.name,
    })),
  };
}

/** Uma proposta com a oportunidade, o cliente, as outras versões e o histórico em palavras. */
export async function getProposal(params: { userId: string; companyId: string; proposalId: string; now?: Date }) {
  await requireCrm(params.userId, params.companyId);
  const proposal = await prisma.proposal.findFirst({ where: { id: params.proposalId, companyId: params.companyId }, include: withItems });
  if (!proposal) throw new AdminActionError("Proposta não encontrada.", 404);
  const today = todayInSaoPaulo(params.now);

  const [opportunity, versions, audit, company] = await Promise.all([
    prisma.opportunity.findUniqueOrThrow({
      where: { id: proposal.opportunityId },
      include: { client: { select: { id: true, name: true, document: true, email: true, phone: true } } },
    }),
    prisma.proposal.findMany({
      where: { opportunityId: proposal.opportunityId },
      select: { id: true, number: true, status: true },
      orderBy: { number: "desc" },
    }),
    prisma.auditLog.findMany({
      where: { companyId: params.companyId, entityType: "Proposal", entityId: proposal.id },
      orderBy: { createdAt: "desc" },
      take: HISTORY_LIMIT,
    }),
    prisma.company.findUniqueOrThrow({ where: { id: params.companyId }, select: { name: true } }),
  ]);

  const { client, ...opportunityFields } = opportunity;
  const context = contextOf(proposal, opportunity, today);
  return {
    proposal,
    opportunity: opportunityFields,
    client,
    companyName: company.name,
    versions,
    draftId: versions.find((v) => v.status === ProposalStatus.DRAFT)?.id ?? null,
    context,
    /** Por que não dá para criar uma nova versão agora (etapa/evento) — ou `null`. */
    createBlockedReason: explainBlockedProposalCreate({ oppStage: opportunity.stage, hasEvent: opportunity.eventId !== null }),
    validUntil: validUntilOf(proposal),
    expired: proposal.status === ProposalStatus.SENT && isExpired(validUntilOf(proposal), today),
    history: await toHistory(audit),
  };
}

/**
 * O que a tela de "nova proposta" precisa: a oportunidade, o cliente, o conteúdo para começar
 * (copiado de uma versão anterior, se pedido — só da MESMA oportunidade) e por que não dá para criar.
 */
export async function prepareNewProposal(params: { userId: string; companyId: string; opportunityId: string; copyFromProposalId?: string | null }) {
  await requireCrm(params.userId, params.companyId);
  const opportunity = await prisma.opportunity.findFirst({
    where: { id: params.opportunityId, companyId: params.companyId },
    include: { client: { select: { id: true, name: true } } },
  });
  if (!opportunity) throw new AdminActionError("Oportunidade não encontrada.", 404);

  const [draft, source] = await Promise.all([
    prisma.proposal.findFirst({ where: { opportunityId: opportunity.id, status: ProposalStatus.DRAFT }, select: { id: true, number: true } }),
    params.copyFromProposalId
      ? prisma.proposal.findFirst({ where: { id: params.copyFromProposalId, opportunityId: opportunity.id, companyId: params.companyId }, include: withItems })
      : Promise.resolve(null),
  ]);

  return {
    opportunity: { id: opportunity.id, title: opportunity.title, stage: opportunity.stage },
    client: opportunity.client,
    existingDraft: draft,
    blockedReason: explainBlockedProposalCreate({ oppStage: opportunity.stage, hasEvent: opportunity.eventId !== null }),
    copiedFrom: source ? { id: source.id, number: source.number } : null,
    initial: source
      ? {
          items: source.items.map((item) => ({ description: item.description, quantity: item.quantity, unitPriceCents: item.unitPriceCents })),
          discountCents: source.discountCents,
          notes: source.notes,
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Escrita
// ---------------------------------------------------------------------------

/**
 * Cria um RASCUNHO (a próxima versão da oportunidade). Sob a trava da oportunidade: dois cliques
 * ao mesmo tempo nunca criam dois rascunhos nem dois números iguais (a segunda vê o primeiro e
 * recebe 409; a chave única [oportunidade, número] é a rede de segurança).
 */
export async function createProposal(params: {
  userId: string;
  companyId: string;
  opportunityId: string;
  input: ProposalInput;
}): Promise<ProposalWithItems> {
  await requireCrm(params.userId, params.companyId);
  const { input } = params;
  assertTotals(input.items, input.discountCents);

  return prisma.$transaction(async (tx) => {
    const found = await tx.opportunity.findFirst({ where: { id: params.opportunityId, companyId: params.companyId }, select: { id: true } });
    if (!found) throw new AdminActionError("Oportunidade não encontrada.", 404);
    await lockOpportunity(tx, found.id);
    const opportunity = await tx.opportunity.findUniqueOrThrow({ where: { id: found.id } });

    const blocked = explainBlockedProposalCreate({ oppStage: opportunity.stage, hasEvent: opportunity.eventId !== null });
    if (blocked) throw new AdminActionError(blocked, 409);

    const draft = await tx.proposal.findFirst({ where: { opportunityId: opportunity.id, status: ProposalStatus.DRAFT }, select: { number: true } });
    if (draft) {
      throw new AdminActionError(`Já existe um rascunho (v${draft.number}) desta oportunidade. Continue por ele ou descarte-o antes de criar outro.`, 409);
    }

    let copiedFromNumber: number | null = null;
    if (input.copiedFromProposalId) {
      const source = await tx.proposal.findFirst({
        where: { id: input.copiedFromProposalId, opportunityId: opportunity.id, companyId: params.companyId },
        select: { number: true },
      });
      if (!source) throw new AdminActionError("A proposta de origem não é desta oportunidade.", 422);
      copiedFromNumber = source.number;
    }

    const last = await tx.proposal.aggregate({ where: { opportunityId: opportunity.id }, _max: { number: true } });
    const totals = computeTotals(input.items, input.discountCents);
    const created = await tx.proposal.create({
      data: {
        companyId: params.companyId,
        opportunityId: opportunity.id,
        number: (last._max.number ?? 0) + 1,
        status: ProposalStatus.DRAFT,
        validUntil: input.validUntil ? dateOnlyToDate(input.validUntil) : null,
        notes: input.notes,
        subtotalCents: totals.subtotalCents,
        discountCents: totals.discountCents,
        totalCents: totals.totalCents,
        createdBy: params.userId,
        updatedBy: params.userId,
        items: { create: input.items.map((item, position) => ({ position, ...item })) },
      },
      include: withItems,
    });

    await auditWriter(tx, params)({
      entityType: "Proposal",
      entityId: created.id,
      action: "PROPOSAL_CREATED",
      after: proposalSnapshot(created),
      metadata: { opportunityId: opportunity.id, copiedFromProposalId: input.copiedFromProposalId, copiedFromNumber },
    });
    return created;
  });
}

/**
 * Edita o RASCUNHO (itens, desconto, validade, observações): troca os itens por inteiro e
 * recalcula os totais. Só rascunho — a proposta enviada não muda (crie uma nova versão). Controle
 * otimista pela versão e sob a trava da oportunidade: editar e enviar ao mesmo tempo nunca enviam
 * um conteúdo diferente do que quem enviou viu.
 */
export async function updateProposal(params: {
  userId: string;
  companyId: string;
  proposalId: string;
  input: ProposalUpdateInput;
  now?: Date;
}): Promise<ProposalWithItems> {
  await requireCrm(params.userId, params.companyId);
  const { baseVersion, ...fields } = params.input;
  assertTotals(fields.items, fields.discountCents);
  const today = todayInSaoPaulo(params.now);

  return prisma.$transaction(async (tx) => {
    const { proposal, opportunity } = await lockForProposal(tx, params.companyId, params.proposalId);

    const blocked = explainBlockedProposalAction("EDIT", contextOf(proposal, opportunity, today));
    if (blocked) throw new AdminActionError(blocked, 409);
    if (proposal.version !== baseVersion) throw new AdminActionError(STALE_MESSAGE, 409);

    const totals = computeTotals(fields.items, fields.discountCents);
    await tx.proposalItem.deleteMany({ where: { proposalId: proposal.id } });
    const updated = await tx.proposal.update({
      where: { id: proposal.id },
      data: {
        validUntil: fields.validUntil ? dateOnlyToDate(fields.validUntil) : null,
        notes: fields.notes,
        subtotalCents: totals.subtotalCents,
        discountCents: totals.discountCents,
        totalCents: totals.totalCents,
        updatedBy: params.userId,
        version: { increment: 1 },
        items: { create: fields.items.map((item, position) => ({ position, ...item })) },
      },
      include: withItems,
    });

    await auditWriter(tx, params)({
      entityType: "Proposal",
      entityId: proposal.id,
      action: "PROPOSAL_UPDATED",
      before: proposalSnapshot(proposal),
      after: proposalSnapshot(updated),
      metadata: { opportunityId: opportunity.id },
    });
    return updated;
  });
}

/**
 * Enviar, aceitar, recusar ou descartar — pelas regras de `explainBlockedProposalAction`, sob a
 * trava da oportunidade e com a versão que a pessoa viu (senão 409).
 *
 * - ENVIAR só REGISTRA que a proposta foi mandada ao cliente (o sistema não envia nada): a
 *   enviada anterior vira SUBSTITUÍDA, e uma oportunidade em "Novo"/"Em contato" passa a "Proposta enviada";
 * - ACEITAR leva a oportunidade em andamento para "Ganho" (não cria o evento — isso é um passo
 *   seguinte, com os dados do evento);
 * - RECUSAR só registra a resposta, e a oportunidade fica onde está;
 * - DESCARTAR apaga o rascunho (fica só a linha na auditoria).
 */
export async function changeProposalStatus(params: {
  userId: string;
  companyId: string;
  proposalId: string;
  input: ProposalActionInput;
  now?: Date;
}): Promise<{ proposal: ProposalWithItems | null; opportunity: Opportunity }> {
  await requireCrm(params.userId, params.companyId);
  const { action, baseVersion, note } = params.input;
  const now = params.now ?? new Date();
  const today = todayInSaoPaulo(now);

  return prisma.$transaction(async (tx) => {
    const { proposal, opportunity } = await lockForProposal(tx, params.companyId, params.proposalId);

    const blocked = explainBlockedProposalAction(action, contextOf(proposal, opportunity, today));
    if (blocked) throw new AdminActionError(blocked, 409);
    if (proposal.version !== baseVersion) throw new AdminActionError(STALE_MESSAGE, 409);

    const audit = auditWriter(tx, params);
    const before = proposalSnapshot(proposal);
    const reload = () => tx.proposal.findUniqueOrThrow({ where: { id: proposal.id }, include: withItems });
    const bump = { updatedBy: params.userId, version: { increment: 1 } } as const;

    if (action === "DISCARD") {
      await tx.proposal.delete({ where: { id: proposal.id } });
      await audit({
        entityType: "Proposal",
        entityId: proposal.id,
        action: "PROPOSAL_DISCARDED",
        before,
        metadata: { opportunityId: opportunity.id },
      });
      return { proposal: null, opportunity };
    }

    if (action === "SEND") {
      // A enviada anterior (no máximo uma) sai de cena: a que vale é a nova.
      const previous = await tx.proposal.findMany({
        where: { opportunityId: opportunity.id, status: ProposalStatus.SENT, NOT: { id: proposal.id } },
        include: withItems,
      });
      for (const old of previous) {
        await tx.proposal.update({ where: { id: old.id }, data: { status: ProposalStatus.SUPERSEDED, ...bump } });
        await audit({
          entityType: "Proposal",
          entityId: old.id,
          action: "PROPOSAL_SUPERSEDED",
          before: proposalSnapshot(old),
          after: { ...proposalSnapshot(old), status: ProposalStatus.SUPERSEDED },
          metadata: { opportunityId: opportunity.id, supersededByNumber: proposal.number },
        });
      }

      await tx.proposal.update({
        where: { id: proposal.id },
        data: { status: ProposalStatus.SENT, sentAt: now, sentBy: params.userId, ...bump },
      });
      const sent = await reload();
      await audit({
        entityType: "Proposal",
        entityId: proposal.id,
        action: "PROPOSAL_SENT",
        before,
        after: proposalSnapshot(sent),
        metadata: { opportunityId: opportunity.id },
      });

      const nextStage = stageAfterSend(opportunity.stage);
      let movedOpportunity = opportunity;
      if (nextStage) {
        movedOpportunity = await tx.opportunity.update({ where: { id: opportunity.id }, data: { stage: nextStage, ...bump } });
        await audit({
          entityType: "Opportunity",
          entityId: opportunity.id,
          action: "OPPORTUNITY_STAGE_CHANGED",
          before: opportunitySnapshot(opportunity),
          after: opportunitySnapshot(movedOpportunity),
          metadata: { proposalId: proposal.id, viaProposalNumber: proposal.number },
        });
      }
      return { proposal: sent, opportunity: movedOpportunity };
    }

    // ACCEPT / REJECT: registram a resposta do cliente.
    const accepting = action === "ACCEPT";
    await tx.proposal.update({
      where: { id: proposal.id },
      data: {
        status: accepting ? ProposalStatus.ACCEPTED : ProposalStatus.REJECTED,
        decidedAt: now,
        decidedBy: params.userId,
        decisionNote: note,
        ...bump,
      },
    });
    const decided = await reload();
    await audit({
      entityType: "Proposal",
      entityId: proposal.id,
      action: accepting ? "PROPOSAL_ACCEPTED" : "PROPOSAL_REJECTED",
      before,
      after: proposalSnapshot(decided),
      metadata: { opportunityId: opportunity.id, note },
    });

    let finalOpportunity = opportunity;
    if (accepting && isOpenStage(opportunity.stage)) {
      finalOpportunity = await tx.opportunity.update({
        where: { id: opportunity.id },
        data: { stage: OpportunityStage.WON, closedAt: now, lostReason: null, ...bump },
      });
      await audit({
        entityType: "Opportunity",
        entityId: opportunity.id,
        action: "OPPORTUNITY_STAGE_CHANGED",
        before: opportunitySnapshot(opportunity),
        after: opportunitySnapshot(finalOpportunity),
        metadata: { proposalId: proposal.id, viaProposalNumber: proposal.number },
      });
    }
    return { proposal: decided, opportunity: finalOpportunity };
  });
}
