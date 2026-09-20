import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/generated/prisma/client";
import { AccessStatus, CompanyRole, EventRole } from "@/generated/prisma/enums";
import { assignableCompanyRoles, canManageMembers, canModifyMember } from "@/lib/domain/permissions";
import { getActiveCompanyRole } from "@/server/auth/membership";
import { generateTemporaryPassword, hashPassword } from "@/server/auth/password";
import { bumpSessionVersion } from "@/server/auth/session-version";
import { AdminActionError } from "@/server/errors";
import { lockEvent } from "@/server/events/lock";

export interface TeamMemberView {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  role: CompanyRole;
  status: AccessStatus;
  /** A pessoa ainda não trocou a senha provisória. */
  mustChangePassword: boolean;
  isSelf: boolean;
  /** Quem está olhando pode alterar (papel, vínculo, senha) este membro? */
  canModify: boolean;
}

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name, "pt-BR");

/** Só titular e administração cuidam da equipe. Devolve o papel de quem age, lido do banco agora. */
async function requireCompanyAdmin(actorId: string, companyId: string): Promise<string> {
  const role = await getActiveCompanyRole(actorId, companyId);
  if (!role || !canManageMembers(role)) {
    throw new AdminActionError("Só a titularidade e a administração da empresa cuidam da equipe.", 403);
  }
  return role;
}

async function loadMembership(companyId: string, membershipId: string) {
  const membership = await prisma.membership.findUnique({
    where: { id: membershipId },
    include: { user: { select: { id: true, name: true, email: true, isActive: true } } },
  });
  // Outra empresa é "não existe": nunca revela nem toca membro de fora.
  if (!membership || membership.companyId !== companyId) {
    throw new AdminActionError("Pessoa não encontrada na equipe.", 404);
  }
  return membership;
}

function assertMayActOn(actorId: string, actorRole: string, target: { userId: string; role: string }) {
  if (target.userId === actorId) {
    throw new AdminActionError(
      "Você não pode alterar o seu próprio vínculo nem a sua senha por aqui. Peça a outra pessoa da administração (a senha se troca em “Trocar senha”).",
      403
    );
  }
  if (!canModifyMember(actorRole, target.role)) {
    throw new AdminActionError("Você não tem permissão para alterar esta pessoa (titular e administração só são alterados pela titularidade).", 403);
  }
}

/** A equipe da empresa, com o que quem olha pode fazer em cada linha. */
export async function listTeam(params: { actorId: string; companyId: string }) {
  const actorRole = await requireCompanyAdmin(params.actorId, params.companyId);
  const memberships = await prisma.membership.findMany({
    where: { companyId: params.companyId },
    include: { user: { select: { name: true, email: true, mustChangePassword: true } } },
  });

  const members: TeamMemberView[] = memberships
    .map((m) => ({
      membershipId: m.id,
      userId: m.userId,
      name: m.user.name,
      email: m.user.email,
      role: m.role,
      status: m.status,
      mustChangePassword: m.user.mustChangePassword,
      isSelf: m.userId === params.actorId,
      canModify: m.userId !== params.actorId && canModifyMember(actorRole, m.role),
    }))
    .sort(byName);

  return { members, assignableRoles: assignableCompanyRoles(actorRole), actorRole };
}

/**
 * Cadastra uma pessoa na equipe. E-mail novo: cria a conta com senha PROVISÓRIA (devolvida uma
 * única vez, nunca guardada em claro) e troca obrigatória no primeiro acesso. E-mail que já tem
 * conta: só a vincula, sem mexer na senha dela.
 */
export async function addMember(params: {
  actorId: string;
  companyId: string;
  name: string;
  email: string;
  role: CompanyRole;
}): Promise<{ membershipId: string; userId: string; temporaryPassword: string | null }> {
  const actorRole = await requireCompanyAdmin(params.actorId, params.companyId);
  if (!(assignableCompanyRoles(actorRole) as string[]).includes(params.role)) {
    throw new AdminActionError("Você não pode conceder este papel.", 403);
  }

  const existing = await prisma.user.findUnique({
    where: { email: params.email },
    include: { memberships: { select: { id: true, companyId: true, role: true, status: true } } },
  });

  // O bcrypt é lento de propósito: fora da transação, para não segurá-la aberta à toa.
  const temporaryPassword = existing ? null : generateTemporaryPassword();
  const temporaryHash = temporaryPassword ? await hashPassword(temporaryPassword) : null;

  try {
    return await prisma.$transaction(async (tx) => {
      if (!existing) {
        const user = await tx.user.create({
          data: {
            email: params.email,
            name: params.name,
            passwordHash: temporaryHash!,
            mustChangePassword: true,
          },
        });
        const membership = await tx.membership.create({
          data: { userId: user.id, companyId: params.companyId, role: params.role },
        });
        await audit(tx, params.companyId, params.actorId, membership.id, "MEMBER_ADDED", undefined, {
          userId: user.id,
          role: membership.role,
          status: membership.status,
          accountCreated: true,
        });
        return { membershipId: membership.id, userId: user.id, temporaryPassword };
      }

      if (!existing.isActive) {
        throw new AdminActionError("Este e-mail pertence a uma conta desativada.", 422);
      }
      const here = existing.memberships.find((m) => m.companyId === params.companyId);
      if (here?.status === AccessStatus.ACTIVE) {
        throw new AdminActionError("Esta pessoa já faz parte da equipe.", 409);
      }
      if (!here && existing.memberships.some((m) => m.status === AccessStatus.ACTIVE)) {
        // Uma pessoa, uma empresa: o app ainda não tem como alternar entre empresas.
        throw new AdminActionError("Este e-mail já tem cadastro em outra empresa e não pode ser adicionado por aqui.", 409);
      }

      if (here) {
        // Vínculo encerrado antes: reativa. Não devolve poder que a administração não teria hoje.
        if (!canModifyMember(actorRole, here.role)) {
          throw new AdminActionError("Você não tem permissão para reativar esta pessoa.", 403);
        }
        const updated = await tx.membership.update({
          where: { id: here.id },
          data: { role: params.role, status: AccessStatus.ACTIVE, revokedAt: null },
        });
        await audit(tx, params.companyId, params.actorId, here.id, "MEMBER_REACTIVATED", { role: here.role, status: here.status }, {
          userId: existing.id,
          role: updated.role,
          status: updated.status,
        });
        return { membershipId: here.id, userId: existing.id, temporaryPassword: null };
      }

      const membership = await tx.membership.create({
        data: { userId: existing.id, companyId: params.companyId, role: params.role },
      });
      await audit(tx, params.companyId, params.actorId, membership.id, "MEMBER_ADDED", undefined, {
        userId: existing.id,
        role: membership.role,
        status: membership.status,
        accountCreated: false,
      });
      return { membershipId: membership.id, userId: existing.id, temporaryPassword: null };
    });
  } catch (err) {
    // Dois cadastros do mesmo e-mail ao mesmo tempo: o segundo INSERT estoura a chave única.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new AdminActionError("Já existe uma conta com este e-mail. Tente de novo.", 409);
    }
    throw err;
  }
}

/**
 * Muda o papel na empresa e/ou encerra/reativa o vínculo.
 *
 * Encerrar o vínculo também RETIRA os acessos da pessoa aos eventos da empresa: se ficassem
 * "dormindo", reativá-la um dia devolveria, sem ninguém decidir, tudo o que ela via antes.
 * E nunca deixa um evento sem gestor: quem é o único gestor de algum evento não sai antes de
 * outra pessoa assumir.
 */
export async function changeMember(params: {
  actorId: string;
  companyId: string;
  membershipId: string;
  role?: CompanyRole;
  status?: AccessStatus;
}) {
  const actorRole = await requireCompanyAdmin(params.actorId, params.companyId);
  const target = await loadMembership(params.companyId, params.membershipId);
  assertMayActOn(params.actorId, actorRole, { userId: target.userId, role: target.role });

  const nextRole = params.role ?? target.role;
  const nextStatus = params.status ?? target.status;
  if (nextRole === target.role && nextStatus === target.status) return target;

  if (nextRole !== target.role && !(assignableCompanyRoles(actorRole) as string[]).includes(nextRole)) {
    throw new AdminActionError("Você não pode conceder este papel.", 403);
  }
  const wasActive = target.status === AccessStatus.ACTIVE;
  const willBeActive = nextStatus === AccessStatus.ACTIVE;
  if (!wasActive && !willBeActive) {
    throw new AdminActionError("Reative o vínculo antes de mudar o papel.", 422);
  }
  if (!wasActive && willBeActive && !target.user.isActive) {
    throw new AdminActionError("A conta desta pessoa está desativada.", 422);
  }

  return prisma.$transaction(async (tx) => {
    let revokedAccessCount = 0;
    let revokedDeviceCount = 0;
    if (wasActive && !willBeActive) {
      const managed = await tx.eventAccess.findMany({
        where: {
          userId: target.userId,
          role: EventRole.MANAGER,
          status: AccessStatus.ACTIVE,
          event: { companyId: params.companyId, deletedAt: null },
        },
        include: { event: { select: { id: true, name: true } } },
        orderBy: { eventId: "asc" }, // ordem crescente: ver `lockEvent`
      });

      const blocking: string[] = [];
      for (const access of managed) {
        await lockEvent(tx, access.eventId);
        const others = await tx.eventAccess.count({
          where: {
            eventId: access.eventId,
            role: EventRole.MANAGER,
            status: AccessStatus.ACTIVE,
            userId: { not: target.userId },
            user: { isActive: true, memberships: { some: { companyId: params.companyId, status: AccessStatus.ACTIVE } } },
          },
        });
        if (others === 0) blocking.push(access.event.name);
      }
      if (blocking.length > 0) {
        throw new AdminActionError(
          `Esta pessoa é a única gestora de: ${blocking.join(", ")}. Nomeie outro gestor antes de encerrar o vínculo.`,
          409
        );
      }

      const revokedAccess = await tx.eventAccess.updateMany({
        where: { userId: target.userId, status: AccessStatus.ACTIVE, event: { companyId: params.companyId } },
        data: { status: AccessStatus.REVOKED, revokedAt: new Date() },
      });
      revokedAccessCount = revokedAccess.count; // vai para o histórico do vínculo, logo abaixo
      // Sem vínculo, sem sessão: o shell do app não abre mais com o token que a pessoa já tinha.
      await bumpSessionVersion(tx, target.userId);
      // E sem aparelho: os dispositivos dela nesta empresa passam a responder "revogado" quando
      // perguntarem (`device-status`) — é assim que o aparelho descobre, sem sessão, e se limpa.
      const revokedDevices = await tx.device.updateMany({
        where: { userId: target.userId, companyId: params.companyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      revokedDeviceCount = revokedDevices.count;
    }

    const updated = await tx.membership.update({
      where: { id: target.id },
      data: {
        role: nextRole,
        status: nextStatus,
        revokedAt: willBeActive ? null : (target.revokedAt ?? new Date()),
      },
    });

    const action = wasActive && !willBeActive ? "MEMBER_REVOKED" : !wasActive && willBeActive ? "MEMBER_REACTIVATED" : "MEMBER_ROLE_CHANGED";
    await tx.auditLog.create({
      data: {
        companyId: params.companyId,
        userId: params.actorId,
        entityType: "Membership",
        entityId: target.id,
        action,
        beforeJson: { userId: target.userId, role: target.role, status: target.status },
        afterJson: { userId: target.userId, role: updated.role, status: updated.status },
        metadata:
          action === "MEMBER_REVOKED"
            ? { eventAccessRevoked: revokedAccessCount, devicesRevoked: revokedDeviceCount }
            : undefined,
      },
    });
    return updated;
  });
}

/**
 * Redefine a senha de alguém (esqueceu ou perdeu o aparelho): nova senha PROVISÓRIA, devolvida uma
 * única vez, com troca obrigatória no próximo acesso. Derruba as sessões já abertas da pessoa —
 * quem estava com a senha antiga (um aparelho perdido, por exemplo) sai na próxima requisição.
 */
export async function resetMemberPassword(params: {
  actorId: string;
  companyId: string;
  membershipId: string;
}): Promise<{ temporaryPassword: string }> {
  const actorRole = await requireCompanyAdmin(params.actorId, params.companyId);
  const target = await loadMembership(params.companyId, params.membershipId);
  assertMayActOn(params.actorId, actorRole, { userId: target.userId, role: target.role });
  if (target.status !== AccessStatus.ACTIVE || !target.user.isActive) {
    throw new AdminActionError("Só se redefine a senha de quem está ativo na equipe.", 422);
  }

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: target.userId }, data: { passwordHash, mustChangePassword: true } });
    await bumpSessionVersion(tx, target.userId);
    await audit(tx, params.companyId, params.actorId, target.userId, "MEMBER_PASSWORD_RESET", undefined, {
      userId: target.userId,
    }, "User");
  });
  return { temporaryPassword };
}

/** Histórico. NUNCA recebe senha nem hash: só quem fez, em quem e o quê. */
async function audit(
  tx: Prisma.TransactionClient,
  companyId: string,
  actorId: string,
  entityId: string,
  action: string,
  before: Prisma.InputJsonValue | undefined,
  after: Prisma.InputJsonValue,
  entityType = "Membership"
) {
  await tx.auditLog.create({
    data: { companyId, userId: actorId, entityType, entityId, action, beforeJson: before, afterJson: after },
  });
}
