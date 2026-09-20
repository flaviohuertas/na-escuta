import { prisma } from "@/lib/db/prisma";
import { AccessStatus, EventRole } from "@/generated/prisma/enums";
import type { RejectionReason } from "@/lib/sync/protocol";

export interface AuthContext {
  userId: string;
}

export interface EventAuthorization {
  allowed: boolean;
  companyId?: string;
  eventRole?: EventRole;
  reason?: RejectionReason;
}

/**
 * Revalida no servidor se o usuário ainda tem conta ativa, vínculo ativo com a empresa E
 * acesso ativo ao evento — nunca confia no que o grant offline do cliente
 * afirmava no momento em que foi emitido (pode ter sido revogado depois).
 */
export async function authorizeEventAccess(
  ctx: AuthContext,
  eventId: string
): Promise<EventAuthorization> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, companyId: true, deletedAt: true },
  });
  if (!event || event.deletedAt) {
    return { allowed: false, reason: "ENTITY_NOT_FOUND" };
  }

  const membership = await prisma.membership.findUnique({
    where: { userId_companyId: { userId: ctx.userId, companyId: event.companyId } },
    // Na mesma consulta (sem ida extra ao banco): conta desativada não sincroniza, mesmo com a
    // sessão (JWT) ainda válida — desativar a conta tem que valer para quem já está logado.
    include: { user: { select: { isActive: true } } },
  });
  if (!membership || membership.status !== AccessStatus.ACTIVE || !membership.user.isActive) {
    return { allowed: false, reason: "MEMBERSHIP_REVOKED" };
  }

  const eventAccess = await prisma.eventAccess.findUnique({
    where: { userId_eventId: { userId: ctx.userId, eventId } },
  });
  if (!eventAccess || eventAccess.status !== AccessStatus.ACTIVE) {
    return { allowed: false, reason: "EVENT_ACCESS_REVOKED" };
  }

  return { allowed: true, companyId: event.companyId, eventRole: eventAccess.role };
}

export function roleCanWrite(role: EventRole): boolean {
  return role === EventRole.MANAGER || role === EventRole.FIELD_STAFF;
}
