import { prisma } from "@/lib/db/prisma";
import type { Event, Prisma } from "@/generated/prisma/client";
import { AccessStatus, EventRole, PendingApprovalStatus } from "@/generated/prisma/enums";
import {
  datesStayValid,
  effectiveChanges,
  eventValue,
  PROPOSABLE_EVENT_FIELDS,
  type EventValues,
  type ProposalView,
} from "@/lib/domain/approval";
import {
  EVENT_CHANGE_ENTITY_TYPE,
  MAX_PENDING_PER_PERSON_PER_EVENT,
  type ProposeEventChangeInput,
  type ReviewDecisionInput,
  type StoredEventChange,
} from "@/lib/domain/approval.schema";
import { canProposeEventChange, canReviewProposals } from "@/lib/domain/permissions";
import { AdminActionError } from "@/server/errors";
import { lockEvent } from "@/server/events/lock";
import { authorizeEventAccess } from "@/server/sync/authorize";
import { applierFor, type ApprovalWithEvent } from "./registry";

/** Quantas propostas já decididas aparecem, além das que esperam. */
const DECIDED_HISTORY_LIMIT = 20;
const MY_PROPOSALS_LIMIT = 50;

/** Os eventos que a pessoa GERENCIA agora: acesso de gestor ativo, conta ativa e vínculo ativo com a empresa. */
function eventsIManage(userId: string): Prisma.EventWhereInput {
  return {
    deletedAt: null,
    eventAccess: { some: { userId, role: EventRole.MANAGER, status: AccessStatus.ACTIVE, user: { isActive: true } } },
    company: { memberships: { some: { userId, status: AccessStatus.ACTIVE } } },
  };
}

/** Os eventos que a pessoa enxerga (mesma regra do catálogo). */
function eventsISee(userId: string): Prisma.EventWhereInput {
  return {
    deletedAt: null,
    eventAccess: { some: { userId, status: AccessStatus.ACTIVE, user: { isActive: true } } },
    company: { memberships: { some: { userId, status: AccessStatus.ACTIVE } } },
  };
}

const withPeople = {
  event: true,
  submittedBy: { select: { id: true, name: true } },
  reviewedBy: { select: { name: true } },
} satisfies Prisma.PendingApprovalInclude;

type ApprovalRow = Prisma.PendingApprovalGetPayload<{ include: typeof withPeople }>;

function toView(row: ApprovalRow): ProposalView {
  const applier = applierFor(row.entityType);
  const presented = applier
    ? applier.present(row as ApprovalWithEvent)
    : { changes: [], conflictFields: [], reason: null, unreadable: true };
  return {
    id: row.id,
    eventId: row.eventId,
    eventName: row.event.name,
    submittedBy: row.submittedBy,
    submittedAt: row.submittedAt.toISOString(),
    status: row.status,
    reason: presented.reason,
    changes: presented.changes,
    conflictFields: presented.conflictFields,
    unreadable: presented.unreadable,
    reviewedByName: row.reviewedBy?.name ?? null,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    reviewNotes: row.reviewNotes,
  };
}

/**
 * Só a equipe de campo do evento propõe (acesso ativo, vínculo e conta ativos — revalidados agora):
 * o gestor edita direto e quem só visualiza não mexe em nada. Usada pela tela de propor e pela ação.
 */
async function requireProposer(userId: string, eventId: string): Promise<void> {
  const access = await authorizeEventAccess({ userId }, eventId);
  if (!access.allowed || !access.eventRole) {
    if (access.reason === "ENTITY_NOT_FOUND") throw new AdminActionError("Evento não encontrado.", 404);
    throw new AdminActionError("Você não tem acesso a este evento.", 403);
  }
  if (!canProposeEventChange(access.eventRole)) {
    throw new AdminActionError(
      canReviewProposals(access.eventRole)
        ? "Você é gestor deste evento: edite-o direto, sem precisar de aprovação."
        : "Sua função neste evento é só de visualização: você não propõe alterações.",
      403
    );
  }
}

/** O evento para a tela de propor — só para quem pode propor nele (mesma checagem de `proposeEventChange`). */
export async function getEventForProposal(params: { userId: string; eventId: string }): Promise<Event> {
  await requireProposer(params.userId, params.eventId);
  return prisma.event.findUniqueOrThrow({ where: { id: params.eventId } });
}

/**
 * PROPÕE uma correção nos dados do evento (só quem `requireProposer` admite).
 *
 * Guarda o que a pessoa VIA (`before`) junto do que propõe (`after`): é o que permite, na decisão,
 * saber se o evento mudou por baixo da proposta.
 */
export async function proposeEventChange(params: { userId: string; input: ProposeEventChangeInput }): Promise<ProposalView> {
  const { eventId, changes, reason } = params.input;
  await requireProposer(params.userId, eventId);

  const created = await prisma.$transaction(async (tx) => {
    // Serializa as propostas do evento: o limite por pessoa abaixo precisa contar sem corrida.
    await lockEvent(tx, eventId);
    const event = await tx.event.findUnique({ where: { id: eventId } });
    if (!event || event.deletedAt) throw new AdminActionError("Evento não encontrado.", 404);

    const waiting = await tx.pendingApproval.count({
      where: { eventId, submittedByUserId: params.userId, status: PendingApprovalStatus.PENDING },
    });
    if (waiting >= MAX_PENDING_PER_PERSON_PER_EVENT) {
      throw new AdminActionError(
        `Você já tem ${waiting} propostas esperando decisão neste evento. Aguarde o gestor decidir antes de propor outra.`,
        409
      );
    }

    // Só o que realmente muda: um campo que já está assim não é proposta.
    const effective = effectiveChanges(event, changes as EventValues);
    const fields = PROPOSABLE_EVENT_FIELDS.filter((field) => field in effective);
    if (fields.length === 0) throw new AdminActionError("O evento já está assim: não há o que propor.", 422);
    if (!datesStayValid(event, effective)) {
      throw new AdminActionError("Com estas datas o término ficaria antes do início.", 422);
    }

    const stored: StoredEventChange = {
      baseVersion: event.version,
      before: Object.fromEntries(fields.map((field) => [field, eventValue(event, field)])),
      after: effective,
      reason: reason?.trim() ? reason.trim() : null,
    };

    const approval = await tx.pendingApproval.create({
      data: {
        companyId: event.companyId,
        eventId,
        entityType: EVENT_CHANGE_ENTITY_TYPE,
        entityId: eventId,
        proposedChangeJson: stored,
        submittedByUserId: params.userId,
      },
    });
    await tx.auditLog.create({
      data: {
        companyId: event.companyId,
        eventId,
        userId: params.userId,
        entityType: "PendingApproval",
        entityId: approval.id,
        action: "APPROVAL_SUBMITTED",
        afterJson: { entityType: EVENT_CHANGE_ENTITY_TYPE, before: stored.before, after: stored.after, reason: stored.reason },
      },
    });
    return approval.id;
  });

  const row = await prisma.pendingApproval.findUniqueOrThrow({ where: { id: created }, include: withPeople });
  return toView(row);
}

/**
 * APROVA ou REJEITA uma proposta. Só o gestor do evento, e nunca a própria proposta.
 *
 * Tudo numa transação com o evento travado: a proposta é "reivindicada" com um `UPDATE … WHERE
 * status = PENDING` (atômico no Postgres), então duas decisões simultâneas — dois gestores, ou um
 * clique duplo — nunca passam as duas: a segunda recebe 409. Aprovar aplica a mudança na MESMA
 * transação; se ela não puder ser aplicada (o evento mudou desde a proposta), tudo desfaz e a
 * proposta continua pendente.
 */
export async function decideProposal(params: {
  reviewerId: string;
  approvalId: string;
  decision: ReviewDecisionInput["decision"];
  notes?: string | null;
}): Promise<ProposalView> {
  const approval = await prisma.pendingApproval.findUnique({ where: { id: params.approvalId } });
  if (!approval) throw new AdminActionError("Proposta não encontrada.", 404);

  const applier = applierFor(approval.entityType);
  if (!applier) throw new AdminActionError("Este tipo de proposta não é reconhecido.", 422);

  const access = await authorizeEventAccess({ userId: params.reviewerId }, approval.eventId);
  // Sem acesso ao evento a proposta "não existe" para quem olha — não revela que há proposta ali.
  if (!access.allowed || !access.eventRole) throw new AdminActionError("Proposta não encontrada.", 404);
  if (!applier.canReview(access.eventRole)) {
    throw new AdminActionError("Só o gestor do evento aprova ou rejeita propostas.", 403);
  }
  // Duas pessoas olhando: quem propõe não decide o que propôs (mesmo que hoje seja gestor).
  if (approval.submittedByUserId === params.reviewerId) {
    throw new AdminActionError("Você não decide a própria proposta: peça a outro gestor do evento.", 403);
  }

  const approved = params.decision === "APPROVE";
  const notes = params.notes?.trim() ? params.notes.trim() : null;
  // A exigência também mora aqui (não só no schema da rota): um chamador futuro não a esquece.
  if (!approved && (notes?.length ?? 0) < 3) {
    throw new AdminActionError("Explique o motivo da rejeição para quem propôs.", 422);
  }

  await prisma.$transaction(async (tx) => {
    await lockEvent(tx, approval.eventId);

    const claimed = await tx.pendingApproval.updateMany({
      where: { id: approval.id, status: PendingApprovalStatus.PENDING },
      data: {
        status: approved ? PendingApprovalStatus.APPROVED : PendingApprovalStatus.REJECTED,
        reviewedByUserId: params.reviewerId,
        reviewedAt: new Date(),
        reviewNotes: notes,
      },
    });
    if (claimed.count === 0) {
      const latest = await tx.pendingApproval.findUniqueOrThrow({ where: { id: approval.id } });
      throw new AdminActionError(
        `Esta proposta já foi ${latest.status === PendingApprovalStatus.APPROVED ? "aprovada" : "rejeitada"} por outra pessoa.`,
        409
      );
    }

    const applied = approved ? await applier.apply(tx, approval, params.reviewerId) : null;

    await tx.auditLog.create({
      data: {
        companyId: approval.companyId,
        eventId: approval.eventId,
        userId: params.reviewerId,
        entityType: "PendingApproval",
        entityId: approval.id,
        action: approved ? "APPROVAL_APPROVED" : "APPROVAL_REJECTED",
        beforeJson: { status: PendingApprovalStatus.PENDING },
        afterJson: { status: approved ? PendingApprovalStatus.APPROVED : PendingApprovalStatus.REJECTED, notes },
        metadata: { proposedBy: approval.submittedByUserId, applied: applied ?? undefined },
      },
    });
  });

  const row = await prisma.pendingApproval.findUniqueOrThrow({ where: { id: approval.id }, include: withPeople });
  return toView(row);
}

/**
 * As propostas dos eventos que a pessoa GERENCIA: as que esperam decisão (mais antigas primeiro) e as
 * últimas já decididas. Não inclui as próprias (não decide a própria proposta).
 */
export async function listProposalsForReview(userId: string): Promise<{ pending: ProposalView[]; decided: ProposalView[] }> {
  const where = (status: Prisma.PendingApprovalWhereInput["status"]): Prisma.PendingApprovalWhereInput => ({
    status,
    submittedByUserId: { not: userId },
    event: eventsIManage(userId),
  });

  const [pending, decided] = await Promise.all([
    prisma.pendingApproval.findMany({
      where: where(PendingApprovalStatus.PENDING),
      include: withPeople,
      orderBy: { submittedAt: "asc" },
    }),
    prisma.pendingApproval.findMany({
      where: where({ not: PendingApprovalStatus.PENDING }),
      include: withPeople,
      orderBy: { reviewedAt: "desc" },
      take: DECIDED_HISTORY_LIMIT,
    }),
  ]);
  return { pending: pending.map(toView), decided: decided.map(toView) };
}

/** As propostas que a pessoa fez (de qualquer situação), das mais novas às mais antigas — só de eventos que ainda enxerga. */
export async function listMyProposals(userId: string): Promise<ProposalView[]> {
  const rows = await prisma.pendingApproval.findMany({
    where: { submittedByUserId: userId, event: eventsISee(userId) },
    include: withPeople,
    orderBy: { submittedAt: "desc" },
    take: MY_PROPOSALS_LIMIT,
  });
  return rows.map(toView);
}

/** Quantas propostas esperam a decisão desta pessoa — o número do menu. */
export function countPendingForReview(userId: string): Promise<number> {
  return prisma.pendingApproval.count({
    where: { status: PendingApprovalStatus.PENDING, submittedByUserId: { not: userId }, event: eventsIManage(userId) },
  });
}
