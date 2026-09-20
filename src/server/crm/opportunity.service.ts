import { prisma } from "@/lib/db/prisma";
import type { Opportunity, Prisma } from "@/generated/prisma/client";
import { AccessStatus, OpportunityStage } from "@/generated/prisma/enums";
import { OPEN_STAGES, explainBlockedMove, isOpenStage, type OpportunityStageName } from "@/lib/domain/crm";
import type {
  ConvertToEventInput,
  OpportunityInput,
  OpportunityUpdateInput,
  StageMoveInput,
} from "@/lib/domain/crm.schema";
import { canManageBudget, canManageCrm } from "@/lib/domain/permissions";
import { AdminActionError } from "@/server/errors";
import { createEventInTx } from "@/server/events/event.service";
import { lockClient, lockOpportunity, requireCrm, requireCrmAndEventCreation } from "./access";
import { toHistory, type HistoryEntry } from "./history";

const OPEN_CAP = 500;
const CLOSED_SHOWN = 30;
const HISTORY_LIMIT = 50;

export interface OpportunityCard {
  id: string;
  title: string;
  clientId: string;
  clientName: string;
  stage: OpportunityStageName;
  expectedValueCents: number | null;
  expectedStartDate: Date | null;
  ownerName: string | null;
  eventId: string | null;
  closedAt: Date | null;
}

const cardInclude = {
  client: { select: { name: true } },
  owner: { select: { name: true } },
} satisfies Prisma.OpportunityInclude;

type CardRow = Prisma.OpportunityGetPayload<{ include: typeof cardInclude }>;

const toCard = (row: CardRow): OpportunityCard => ({
  id: row.id,
  title: row.title,
  clientId: row.clientId,
  clientName: row.client.name,
  stage: row.stage,
  expectedValueCents: row.expectedValueCents,
  expectedStartDate: row.expectedStartDate,
  ownerName: row.owner?.name ?? null,
  eventId: row.eventId,
  closedAt: row.closedAt,
});

/** O que a auditoria guarda da oportunidade (antes/depois). Também usado ao mudar a etapa por uma proposta. */
export function opportunitySnapshot(o: Opportunity) {
  return {
    clientId: o.clientId,
    title: o.title,
    description: o.description,
    stage: o.stage,
    expectedValueCents: o.expectedValueCents,
    expectedStartDate: o.expectedStartDate?.toISOString() ?? null,
    expectedEndDate: o.expectedEndDate?.toISOString() ?? null,
    ownerUserId: o.ownerUserId,
    lostReason: o.lostReason,
    eventId: o.eventId,
  };
}
const snapshot = opportunitySnapshot;

async function loadOpportunity(companyId: string, opportunityId: string): Promise<Opportunity> {
  const found = await prisma.opportunity.findFirst({ where: { id: opportunityId, companyId } });
  if (!found) throw new AdminActionError("Oportunidade não encontrada.", 404);
  return found;
}

/** O responsável precisa ser alguém do comercial DESTA empresa (vínculo e conta ativos). */
async function assertValidOwner(tx: Prisma.TransactionClient, companyId: string, ownerUserId: string) {
  const membership = await tx.membership.findUnique({
    where: { userId_companyId: { userId: ownerUserId, companyId } },
    include: { user: { select: { isActive: true } } },
  });
  if (!membership || membership.status !== AccessStatus.ACTIVE || !membership.user.isActive || !canManageCrm(membership.role)) {
    throw new AdminActionError("O responsável precisa ser uma pessoa do comercial desta empresa.", 422);
  }
}

/** As pessoas que podem ser responsáveis por uma oportunidade (o comercial da empresa). */
export async function listOwnerOptions(params: { userId: string; companyId: string }) {
  await requireCrm(params.userId, params.companyId);
  const rows = await prisma.membership.findMany({
    where: { companyId: params.companyId, status: AccessStatus.ACTIVE, user: { isActive: true } },
    include: { user: { select: { id: true, name: true } } },
  });
  return rows
    .filter((m) => canManageCrm(m.role))
    .map((m) => ({ id: m.user.id, name: m.user.name }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

export interface PipelineColumn {
  stage: OpportunityStageName;
  count: number;
  totalCents: number;
  items: OpportunityCard[];
}

/**
 * O funil: uma coluna por etapa em andamento (com a contagem e o valor estimado SOMADO de todas,
 * mesmo que a tela mostre só as primeiras) e as últimas ganhas e perdidas.
 */
export async function listPipeline(params: { userId: string; companyId: string }): Promise<{
  columns: PipelineColumn[];
  won: OpportunityCard[];
  lost: OpportunityCard[];
  truncated: boolean;
}> {
  await requireCrm(params.userId, params.companyId);
  const openStages = [...OPEN_STAGES];

  const [open, totals, won, lost] = await Promise.all([
    prisma.opportunity.findMany({
      where: { companyId: params.companyId, stage: { in: openStages } },
      include: cardInclude,
      orderBy: { createdAt: "asc" },
      take: OPEN_CAP + 1,
    }),
    prisma.opportunity.groupBy({
      by: ["stage"],
      where: { companyId: params.companyId, stage: { in: openStages } },
      _count: { _all: true },
      _sum: { expectedValueCents: true },
    }),
    prisma.opportunity.findMany({
      where: { companyId: params.companyId, stage: OpportunityStage.WON },
      include: cardInclude,
      orderBy: { closedAt: "desc" },
      take: CLOSED_SHOWN,
    }),
    prisma.opportunity.findMany({
      where: { companyId: params.companyId, stage: OpportunityStage.LOST },
      include: cardInclude,
      orderBy: { closedAt: "desc" },
      take: CLOSED_SHOWN,
    }),
  ]);

  const cards = open.slice(0, OPEN_CAP).map(toCard);
  const columns: PipelineColumn[] = OPEN_STAGES.map((stage) => {
    const total = totals.find((t) => t.stage === stage);
    return {
      stage,
      count: total?._count._all ?? 0,
      totalCents: total?._sum.expectedValueCents ?? 0,
      items: cards.filter((card) => card.stage === stage),
    };
  });
  return { columns, won: won.map(toCard), lost: lost.map(toCard), truncated: open.length > OPEN_CAP };
}

export type { HistoryEntry };

/**
 * Uma oportunidade com o cliente, o responsável, o evento que virou e o histórico em palavras —
 * inclusive o das propostas dela (criadas, enviadas, aceitas…) e o do orçamento, que a auditoria
 * guarda com o id da oportunidade em `metadata`.
 */
export async function getOpportunity(params: { userId: string; companyId: string; opportunityId: string }) {
  const role = await requireCrm(params.userId, params.companyId);
  const opportunity = await loadOpportunity(params.companyId, params.opportunityId);
  // O histórico do orçamento traz custos ("custo de R$ X para R$ Y"): só entra para quem pode ver o
  // orçamento (`canManageBudget`). A produção enxerga a oportunidade, mas não esse rastro.
  const budgetHistory = canManageBudget(role)
    ? [{ entityType: "Budget", metadata: { path: ["opportunityId"], equals: opportunity.id } }]
    : [];

  const [client, owner, event, audit] = await Promise.all([
    prisma.client.findUniqueOrThrow({ where: { id: opportunity.clientId }, select: { id: true, name: true, archivedAt: true } }),
    opportunity.ownerUserId
      ? prisma.user.findUnique({ where: { id: opportunity.ownerUserId }, select: { id: true, name: true } })
      : Promise.resolve(null),
    opportunity.eventId
      ? prisma.event.findUnique({ where: { id: opportunity.eventId }, select: { id: true, name: true } })
      : Promise.resolve(null),
    prisma.auditLog.findMany({
      where: {
        companyId: params.companyId,
        OR: [
          { entityType: "Opportunity", entityId: opportunity.id },
          { entityType: "Proposal", metadata: { path: ["opportunityId"], equals: opportunity.id } },
          ...budgetHistory,
        ],
      },
      orderBy: { createdAt: "desc" },
      take: HISTORY_LIMIT,
    }),
  ]);

  const history = await toHistory(audit);

  return { opportunity, client, owner, event, history };
}

/**
 * Abre uma oportunidade para um cliente ATIVO da empresa. Com a linha do cliente travada: arquivar
 * o cliente ao mesmo tempo não deixa uma oportunidade viva num cliente arquivado.
 */
export async function createOpportunity(params: {
  userId: string;
  companyId: string;
  input: OpportunityInput;
}): Promise<Opportunity> {
  await requireCrm(params.userId, params.companyId);
  const ownerUserId = params.input.ownerUserId ?? params.userId;

  return prisma.$transaction(async (tx) => {
    await lockClient(tx, params.input.clientId);
    const client = await tx.client.findFirst({ where: { id: params.input.clientId, companyId: params.companyId } });
    if (!client) throw new AdminActionError("Cliente não encontrado.", 404);
    if (client.archivedAt) throw new AdminActionError("Este cliente está arquivado. Reative-o para abrir uma oportunidade.", 409);
    await assertValidOwner(tx, params.companyId, ownerUserId);

    const created = await tx.opportunity.create({
      data: {
        companyId: params.companyId,
        clientId: client.id,
        title: params.input.title,
        description: params.input.description,
        expectedValueCents: params.input.expectedValueCents,
        expectedStartDate: params.input.expectedStartDate ? new Date(params.input.expectedStartDate) : null,
        expectedEndDate: params.input.expectedEndDate ? new Date(params.input.expectedEndDate) : null,
        ownerUserId,
        createdBy: params.userId,
        updatedBy: params.userId,
      },
    });
    await tx.auditLog.create({
      data: {
        companyId: params.companyId,
        userId: params.userId,
        entityType: "Opportunity",
        entityId: created.id,
        action: "OPPORTUNITY_CREATED",
        afterJson: snapshot(created),
      },
    });
    return created;
  });
}

/**
 * Edita os dados da oportunidade (título, valor, datas, responsável). O cliente não muda depois de
 * criada — para outro cliente, abra outra oportunidade — e a etapa só muda por `moveStage`.
 * Controle otimista pela versão.
 */
export async function updateOpportunity(params: {
  userId: string;
  companyId: string;
  opportunityId: string;
  input: OpportunityUpdateInput;
}): Promise<Opportunity> {
  await requireCrm(params.userId, params.companyId);
  const { baseVersion, ...fields } = params.input;

  return prisma.$transaction(async (tx) => {
    const current = await tx.opportunity.findFirst({ where: { id: params.opportunityId, companyId: params.companyId } });
    if (!current) throw new AdminActionError("Oportunidade não encontrada.", 404);
    if (fields.clientId !== current.clientId) {
      throw new AdminActionError("O cliente de uma oportunidade não muda: abra outra oportunidade para o outro cliente.", 422);
    }
    const ownerUserId = fields.ownerUserId ?? current.ownerUserId;
    if (ownerUserId && ownerUserId !== current.ownerUserId) await assertValidOwner(tx, params.companyId, ownerUserId);

    const written = await tx.opportunity.updateMany({
      where: { id: current.id, companyId: params.companyId, version: baseVersion },
      data: {
        title: fields.title,
        description: fields.description,
        expectedValueCents: fields.expectedValueCents,
        expectedStartDate: fields.expectedStartDate ? new Date(fields.expectedStartDate) : null,
        expectedEndDate: fields.expectedEndDate ? new Date(fields.expectedEndDate) : null,
        ownerUserId,
        updatedBy: params.userId,
        version: { increment: 1 },
      },
    });
    if (written.count === 0) {
      throw new AdminActionError(
        "Esta oportunidade foi alterada por outra pessoa enquanto você editava. Recarregue para ver os dados atuais.",
        409
      );
    }

    const updated = await tx.opportunity.findUniqueOrThrow({ where: { id: current.id } });
    await tx.auditLog.create({
      data: {
        companyId: params.companyId,
        userId: params.userId,
        entityType: "Opportunity",
        entityId: current.id,
        action: "OPPORTUNITY_UPDATED",
        beforeJson: snapshot(current),
        afterJson: snapshot(updated),
      },
    });
    return updated;
  });
}

/**
 * Move a oportunidade no funil, pelas regras de `explainBlockedMove`. Perder exige o motivo;
 * ganhar ou perder fecha (`closedAt`); reabrir limpa o fechamento. Controle otimista pela versão:
 * dois movimentos ao mesmo tempo — o segundo recebe 409 em vez de sobrescrever o primeiro.
 */
export async function moveStage(params: {
  userId: string;
  companyId: string;
  opportunityId: string;
  input: StageMoveInput;
}): Promise<Opportunity> {
  await requireCrm(params.userId, params.companyId);
  const { stage, lostReason, baseVersion } = params.input;

  return prisma.$transaction(async (tx) => {
    const current = await tx.opportunity.findFirst({ where: { id: params.opportunityId, companyId: params.companyId } });
    if (!current) throw new AdminActionError("Oportunidade não encontrada.", 404);

    const blocked = explainBlockedMove(current.stage, stage, { hasEvent: current.eventId !== null });
    if (blocked) throw new AdminActionError(blocked, 409);

    const closing = !isOpenStage(stage);
    const written = await tx.opportunity.updateMany({
      where: { id: current.id, companyId: params.companyId, version: baseVersion },
      data: {
        stage,
        closedAt: closing ? new Date() : null,
        lostReason: stage === "LOST" ? lostReason : null,
        updatedBy: params.userId,
        version: { increment: 1 },
      },
    });
    if (written.count === 0) {
      throw new AdminActionError(
        "Esta oportunidade foi alterada por outra pessoa enquanto você olhava. Recarregue para ver a etapa atual.",
        409
      );
    }

    const updated = await tx.opportunity.findUniqueOrThrow({ where: { id: current.id } });
    await tx.auditLog.create({
      data: {
        companyId: params.companyId,
        userId: params.userId,
        entityType: "Opportunity",
        entityId: current.id,
        action: "OPPORTUNITY_STAGE_CHANGED",
        beforeJson: snapshot(current),
        afterJson: snapshot(updated),
      },
    });
    return updated;
  });
}

/**
 * Transforma a oportunidade em EVENTO: cria o evento (a pessoa vira gestora dele), vincula à
 * oportunidade e a marca como ganha — tudo numa transação, com a oportunidade travada: duas
 * conversões ao mesmo tempo nunca criam dois eventos (a segunda vê o vínculo e recebe 409; a
 * chave única em `eventId` é a rede de segurança). Perdida não vira evento (reabra antes).
 */
export async function convertToEvent(params: {
  userId: string;
  companyId: string;
  opportunityId: string;
  input: ConvertToEventInput;
}) {
  await requireCrmAndEventCreation(params.userId, params.companyId);

  return prisma.$transaction(async (tx) => {
    await lockOpportunity(tx, params.opportunityId);
    const current = await tx.opportunity.findFirst({ where: { id: params.opportunityId, companyId: params.companyId } });
    if (!current) throw new AdminActionError("Oportunidade não encontrada.", 404);
    if (current.eventId) throw new AdminActionError("Esta oportunidade já virou um evento.", 409);
    if (current.stage === OpportunityStage.LOST) {
      throw new AdminActionError("Uma oportunidade perdida não vira evento. Reabra-a antes.", 409);
    }
    if (current.version !== params.input.baseVersion) {
      throw new AdminActionError(
        "Esta oportunidade foi alterada por outra pessoa enquanto você olhava. Recarregue para ver os dados atuais.",
        409
      );
    }

    const event = await createEventInTx(tx, {
      userId: params.userId,
      companyId: params.companyId,
      input: params.input.event,
      metadata: { opportunityId: current.id },
    });
    const updated = await tx.opportunity.update({
      where: { id: current.id },
      data: {
        eventId: event.id,
        stage: OpportunityStage.WON,
        closedAt: current.closedAt ?? new Date(),
        lostReason: null,
        updatedBy: params.userId,
        version: { increment: 1 },
      },
    });
    await tx.auditLog.create({
      data: {
        companyId: params.companyId,
        eventId: event.id,
        userId: params.userId,
        entityType: "Opportunity",
        entityId: current.id,
        action: "OPPORTUNITY_CONVERTED",
        beforeJson: snapshot(current),
        afterJson: snapshot(updated),
        metadata: { eventId: event.id },
      },
    });
    return { event, opportunity: updated };
  });
}
