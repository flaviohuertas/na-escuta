import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { AccessStatus, EventRole } from "@/generated/prisma/enums";
import { AdminActionError } from "@/server/errors";
import { requireEventManager } from "./event.service";
import { lockEvent } from "./lock";

export interface EventAccessRowView {
  userId: string;
  name: string;
  email: string;
  role: EventRole;
  status: AccessStatus;
  grantedAt: Date;
  revokedAt: Date | null;
  /** O vínculo da pessoa com a empresa ainda vale? Sem ele o acesso ao evento não funciona. */
  membershipActive: boolean;
}

/** Quem da empresa ainda pode ser convidado para o evento. */
export interface AccessCandidateView {
  userId: string;
  name: string;
  email: string;
  companyRole: string;
}

const MANAGE_PEOPLE = "gerenciar as pessoas dele";

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name, "pt-BR");

/**
 * Dentro de uma transação passe o `tx`: consultar pelo cliente global ali pede uma SEGUNDA conexão
 * enquanto a transação segura a primeira — com o pool cheio, todos esperam por todos.
 */
async function requireActiveMember(companyId: string, userId: string, db: Prisma.TransactionClient | typeof prisma = prisma): Promise<void> {
  const membership = await db.membership.findUnique({
    where: { userId_companyId: { userId, companyId } },
    include: { user: { select: { isActive: true } } },
  });
  if (!membership || membership.status !== AccessStatus.ACTIVE || !membership.user.isActive) {
    throw new AdminActionError("Esta pessoa não faz parte da empresa, ou o vínculo dela foi encerrado.", 422);
  }
}

/** Quem tem (ou já teve) acesso ao evento, e quem da empresa ainda pode ser convidado. Só o gestor do evento. */
export async function listEventAccess(params: { actorId: string; eventId: string }) {
  const { companyId } = await requireEventManager(params.actorId, params.eventId, MANAGE_PEOPLE);

  const [accessRows, members] = await Promise.all([
    prisma.eventAccess.findMany({
      where: { eventId: params.eventId },
      include: { user: { select: { name: true, email: true } } },
    }),
    prisma.membership.findMany({
      where: { companyId, status: AccessStatus.ACTIVE, user: { isActive: true } },
      include: { user: { select: { name: true, email: true } } },
    }),
  ]);

  const activeMemberIds = new Set(members.map((m) => m.userId));
  const rows: EventAccessRowView[] = accessRows
    .map((row) => ({
      userId: row.userId,
      name: row.user.name,
      email: row.user.email,
      role: row.role,
      status: row.status,
      grantedAt: row.grantedAt,
      revokedAt: row.revokedAt,
      membershipActive: activeMemberIds.has(row.userId),
    }))
    .sort(byName);

  const withActiveAccess = new Set(accessRows.filter((r) => r.status === AccessStatus.ACTIVE).map((r) => r.userId));
  const candidates: AccessCandidateView[] = members
    .filter((m) => !withActiveAccess.has(m.userId))
    .map((m) => ({ userId: m.userId, name: m.user.name, email: m.user.email, companyRole: m.role }))
    .sort(byName);

  return { rows, candidates };
}

/** Dá (ou devolve) acesso ao evento a alguém da empresa. Só o gestor do evento. */
export async function grantEventAccess(params: {
  actorId: string;
  eventId: string;
  userId: string;
  role: EventRole;
}) {
  const { companyId } = await requireEventManager(params.actorId, params.eventId, MANAGE_PEOPLE);
  await requireActiveMember(companyId, params.userId);

  return prisma.$transaction(async (tx) => {
    await lockEvent(tx, params.eventId);
    const existing = await tx.eventAccess.findUnique({
      where: { userId_eventId: { userId: params.userId, eventId: params.eventId } },
    });
    if (existing?.status === AccessStatus.ACTIVE) {
      throw new AdminActionError("Esta pessoa já tem acesso a este evento.", 409);
    }

    const access = existing
      ? await tx.eventAccess.update({
          where: { id: existing.id },
          data: {
            role: params.role,
            status: AccessStatus.ACTIVE,
            grantedBy: params.actorId,
            grantedAt: new Date(),
            revokedAt: null,
          },
        })
      : await tx.eventAccess.create({
          data: { userId: params.userId, eventId: params.eventId, role: params.role, grantedBy: params.actorId },
        });

    await tx.auditLog.create({
      data: {
        companyId,
        eventId: params.eventId,
        userId: params.actorId,
        entityType: "EventAccess",
        entityId: access.id,
        action: existing ? "ACCESS_REGRANTED" : "ACCESS_GRANTED",
        beforeJson: existing ? { role: existing.role, status: existing.status } : undefined,
        afterJson: { userId: params.userId, role: access.role, status: access.status },
      },
    });
    return access;
  });
}

/**
 * Muda o papel de alguém no evento, ou revoga/reativa o acesso. Só o gestor do evento.
 * Nunca deixa o evento sem gestor: o último gestor ativo não pode ser rebaixado nem retirado.
 */
export async function changeEventAccess(params: {
  actorId: string;
  eventId: string;
  userId: string;
  role?: EventRole;
  status?: AccessStatus;
}) {
  const { companyId } = await requireEventManager(params.actorId, params.eventId, MANAGE_PEOPLE);

  return prisma.$transaction(async (tx) => {
    await lockEvent(tx, params.eventId);
    const access = await tx.eventAccess.findUnique({
      where: { userId_eventId: { userId: params.userId, eventId: params.eventId } },
    });
    if (!access) throw new AdminActionError("Esta pessoa não tem registro de acesso a este evento.", 404);

    const nextRole = params.role ?? access.role;
    const nextStatus = params.status ?? access.status;
    if (nextRole === access.role && nextStatus === access.status) return access;

    const wasActive = access.status === AccessStatus.ACTIVE;
    const willBeActive = nextStatus === AccessStatus.ACTIVE;

    if (!wasActive && !willBeActive) {
      throw new AdminActionError("Reative o acesso antes de mudar o papel.", 422);
    }
    if (!wasActive && willBeActive) {
      // Reativar é conceder de novo: a pessoa precisa ainda ser da empresa.
      await requireActiveMember(companyId, params.userId, tx);
    }

    const losesManagement = wasActive && access.role === EventRole.MANAGER && (!willBeActive || nextRole !== EventRole.MANAGER);
    if (losesManagement) {
      const otherManagers = await tx.eventAccess.count({
        where: {
          eventId: params.eventId,
          role: EventRole.MANAGER,
          status: AccessStatus.ACTIVE,
          userId: { not: params.userId },
          // Só conta quem de fato consegue gerir: conta ativa e vínculo ativo com a empresa.
          user: { isActive: true, memberships: { some: { companyId, status: AccessStatus.ACTIVE } } },
        },
      });
      if (otherManagers === 0) {
        throw new AdminActionError(
          "O evento precisa de pelo menos um gestor com acesso ativo. Nomeie outro gestor antes de tirar ou rebaixar este.",
          409
        );
      }
    }

    const reactivating = !wasActive && willBeActive;
    const updated = await tx.eventAccess.update({
      where: { id: access.id },
      data: {
        role: nextRole,
        status: nextStatus,
        revokedAt: willBeActive ? null : (access.revokedAt ?? new Date()),
        ...(reactivating ? { grantedBy: params.actorId, grantedAt: new Date() } : {}),
      },
    });

    const action = wasActive && !willBeActive ? "ACCESS_REVOKED" : reactivating ? "ACCESS_REACTIVATED" : "ACCESS_ROLE_CHANGED";
    await tx.auditLog.create({
      data: {
        companyId,
        eventId: params.eventId,
        userId: params.actorId,
        entityType: "EventAccess",
        entityId: access.id,
        action,
        beforeJson: { userId: params.userId, role: access.role, status: access.status },
        afterJson: { userId: params.userId, role: updated.role, status: updated.status },
      },
    });
    return updated;
  });
}
