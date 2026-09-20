import type { Prisma } from "@/generated/prisma/client";
import { canCreateEvents, canManageCrm } from "@/lib/domain/permissions";
import { getActiveCompanyRole } from "@/server/auth/membership";
import { AdminActionError } from "@/server/errors";

/**
 * Só quem cuida do comercial (papel lido do BANCO agora — o JWT continua válido depois de uma
 * revogação — e vínculo e conta ativos) passa. Devolve o papel na empresa.
 */
export async function requireCrm(userId: string, companyId: string): Promise<string> {
  const role = await getActiveCompanyRole(userId, companyId);
  if (!role || !canManageCrm(role)) {
    throw new AdminActionError("Você não tem acesso ao comercial desta empresa.", 403);
  }
  return role;
}

/** Transformar uma oportunidade em evento exige, além do comercial, poder criar eventos. */
export async function requireCrmAndEventCreation(userId: string, companyId: string): Promise<void> {
  const role = await requireCrm(userId, companyId);
  if (!canCreateEvents(role)) {
    throw new AdminActionError("Você não tem permissão para criar eventos nesta empresa.", 403);
  }
}

/**
 * Trava a linha do cliente até o fim da transação (`SELECT … FOR UPDATE`). Arquivar um cliente e
 * abrir uma oportunidade para ele ao mesmo tempo passariam as duas pelas conferências ("não tem
 * oportunidade em andamento" / "não está arquivado") e deixariam uma oportunidade viva num cliente
 * arquivado. Com a trava, a segunda espera a primeira terminar e reavalia.
 */
export async function lockClient(tx: Prisma.TransactionClient, clientId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM clients WHERE id = ${clientId} FOR UPDATE`;
}

/** Idem para a oportunidade: duas conversões em evento ao mesmo tempo nunca criam dois eventos. */
export async function lockOpportunity(tx: Prisma.TransactionClient, opportunityId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM opportunities WHERE id = ${opportunityId} FOR UPDATE`;
}
