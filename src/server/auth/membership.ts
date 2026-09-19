import { prisma } from "@/lib/db/prisma";
import { AccessStatus } from "@/generated/prisma/enums";

/**
 * O papel da pessoa na empresa, lido AGORA no banco — ou `null` se ela não tem vínculo ativo,
 * ou se a conta foi desativada. Nunca use o token de sessão para isso: o JWT continua válido
 * depois de uma revogação, o banco não.
 */
export async function getActiveCompanyRole(userId: string, companyId: string): Promise<string | null> {
  const membership = await prisma.membership.findUnique({
    where: { userId_companyId: { userId, companyId } },
    include: { user: { select: { isActive: true } } },
  });
  if (!membership || membership.status !== AccessStatus.ACTIVE || !membership.user.isActive) return null;
  return membership.role;
}
