import type { Prisma } from "@/generated/prisma/client";
import { canManageSuppliers } from "@/lib/domain/permissions";
import { getActiveCompanyRole } from "@/server/auth/membership";
import { AdminActionError } from "@/server/errors";

/**
 * O cadastro de fornecedores é de titular, administração e produção (`canManageSuppliers`). Papel
 * lido do BANCO a cada chamada (o JWT continua válido depois de uma revogação ou de um
 * rebaixamento), com vínculo e conta ativos. Devolve o papel na empresa.
 *
 * Atenção: o cadastro NÃO inclui o dinheiro (gasto e orçado por fornecedor) — isso passa por
 * `requireFinance`.
 */
export async function requireSuppliers(userId: string, companyId: string): Promise<string> {
  const role = await getActiveCompanyRole(userId, companyId);
  if (!role || !canManageSuppliers(role)) {
    throw new AdminActionError("Você não tem acesso aos fornecedores desta empresa.", 403);
  }
  return role;
}

/**
 * Trava a linha do fornecedor até o fim da transação (`SELECT … FOR UPDATE`). Arquivar um
 * fornecedor e vinculá-lo a um item ao mesmo tempo passariam as duas pelas conferências e deixariam
 * um vínculo NOVO com um arquivado; com a trava, a segunda espera e reavalia.
 */
export async function lockSupplier(tx: Prisma.TransactionClient, supplierId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM suppliers WHERE id = ${supplierId} FOR UPDATE`;
}
