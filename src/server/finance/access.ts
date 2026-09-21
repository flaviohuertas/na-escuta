import { canManageFinance } from "@/lib/domain/permissions";
import { getActiveCompanyRole } from "@/server/auth/membership";
import { AdminActionError } from "@/server/errors";

/**
 * O financeiro (custo realizado e margem realizada) é só de quem manda — titular e administração
 * (`canManageFinance`). Papel lido do BANCO a cada chamada (o JWT continua válido depois de uma
 * revogação ou de um rebaixamento), com vínculo e conta ativos. Devolve o papel na empresa.
 */
export async function requireFinance(userId: string, companyId: string): Promise<string> {
  const role = await getActiveCompanyRole(userId, companyId);
  if (!role || !canManageFinance(role)) {
    throw new AdminActionError("Você não tem acesso ao financeiro desta empresa.", 403);
  }
  return role;
}
