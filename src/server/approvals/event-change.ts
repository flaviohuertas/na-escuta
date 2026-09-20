import type { PendingApproval, Prisma } from "@/generated/prisma/client";
import {
  buildFieldChanges,
  conflictingFields,
  datesStayValid,
  eventValue,
  fieldLabel,
  PROPOSABLE_EVENT_FIELDS,
  sameEventValue,
  type EventValues,
} from "@/lib/domain/approval";
import { StoredEventChangeSchema } from "@/lib/domain/approval.schema";
import { canReviewProposals } from "@/lib/domain/permissions";
import { AdminActionError } from "@/server/errors";
import type { AppliedChange, ApprovalApplier, ApprovalWithEvent } from "./registry";

/**
 * O tipo "correção dos dados do evento": a equipe de campo propõe, o gestor decide. Aprovar aplica
 * a mudança no evento pelo mesmo caminho da edição direta (versão sobe, aparelhos preparados a
 * recebem no próximo pull, histórico de auditoria) — e só se o evento ainda estiver como a pessoa o
 * via ao propor, campo a campo.
 */
export const eventChangeApplier: ApprovalApplier = {
  canReview: canReviewProposals,

  async apply(tx: Prisma.TransactionClient, approval: PendingApproval, reviewerId: string): Promise<AppliedChange> {
    const stored = StoredEventChangeSchema.safeParse(approval.proposedChangeJson);
    if (!stored.success || approval.entityId !== approval.eventId) {
      throw new AdminActionError("Esta proposta está corrompida e não pode ser aplicada. Rejeite-a.", 422);
    }
    const { before, after } = stored.data;

    const current = await tx.event.findUnique({ where: { id: approval.eventId } });
    if (!current || current.deletedAt) throw new AdminActionError("O evento não existe mais.", 409);

    const target = { entityType: "Event", entityId: current.id };
    const fields = PROPOSABLE_EVENT_FIELDS.filter((field) => field in after);

    // Alguém já deixou o evento como a proposta quer: aprovar não escreve nada (não sobe a versão —
    // que faria todo aparelho preparado baixar o evento de novo — nem enche o histórico).
    if (fields.every((field) => sameEventValue(field, eventValue(current, field), after[field]))) {
      return { ...target, before: pick(current, fields), after: pick(current, fields) };
    }

    // O evento mudou, nestes campos, depois da proposta: decidir aqui seria sobre um retrato velho e
    // sobrescreveria em silêncio a edição de outra pessoa.
    const conflicts = conflictingFields(before, current);
    if (conflicts.length > 0) {
      throw new AdminActionError(
        `O evento foi alterado depois da proposta (${conflicts.map(fieldLabel).join(", ")}). Rejeite esta proposta e peça uma nova, ou edite o evento direto.`,
        409
      );
    }
    if (!datesStayValid(current, after)) {
      throw new AdminActionError("Com estas datas o término ficaria antes do início. Rejeite a proposta.", 409);
    }

    const updated = await tx.event.update({
      where: { id: current.id },
      data: {
        ...(fields.includes("name") && { name: after.name! }),
        ...(fields.includes("description") && { description: after.description ?? null }),
        ...(fields.includes("location") && { location: after.location ?? null }),
        ...(fields.includes("startDate") && { startDate: new Date(after.startDate!) }),
        ...(fields.includes("endDate") && { endDate: new Date(after.endDate!) }),
        ...(fields.includes("status") && { status: after.status! }),
        updatedBy: reviewerId,
        version: { increment: 1 },
      },
    });

    await tx.auditLog.create({
      data: {
        companyId: updated.companyId,
        eventId: updated.id,
        userId: reviewerId,
        entityType: "Event",
        entityId: updated.id,
        action: "UPDATE",
        beforeJson: current,
        afterJson: updated,
        // Quem decidiu é o `userId`; quem propôs e qual proposta ficam aqui, para o histórico contar a história inteira.
        metadata: { approvalId: approval.id, proposedBy: approval.submittedByUserId },
      },
    });
    return { ...target, before: pick(current, fields), after: pick(updated, fields) };
  },

  present(approval: ApprovalWithEvent) {
    const stored = StoredEventChangeSchema.safeParse(approval.proposedChangeJson);
    if (!stored.success) return { changes: [], conflictFields: [], reason: null, unreadable: true };

    const changes = buildFieldChanges(stored.data, approval.event);
    return {
      changes,
      // O conflito só importa enquanto a proposta espera decisão.
      conflictFields: approval.status === "PENDING" ? changes.filter((c) => c.conflict).map((c) => c.field) : [],
      reason: stored.data.reason,
      unreadable: false,
    };
  },
};

/** Os campos pedidos do evento, no formato das propostas (para o histórico de auditoria). */
function pick(event: Parameters<typeof eventValue>[0], fields: readonly (typeof PROPOSABLE_EVENT_FIELDS)[number][]): EventValues {
  return Object.fromEntries(fields.map((field) => [field, eventValue(event, field)]));
}
