import { Prisma } from "@/generated/prisma/client";
import { AdminActionError } from "@/server/errors";

/**
 * Confere os fornecedores do CADASTRO que um orçamento ou lançamento está citando e devolve
 * `id → nome`, para o servidor gravar o nome legível junto do vínculo. Regras:
 * - o fornecedor precisa ser DESTA empresa (de outra empresa ou inexistente: "não encontrado" —
 *   não revela que existe);
 * - um ARQUIVADO não recebe vínculo novo (409), mas um vínculo que já existia continua valendo
 *   (`alreadyLinked`): editar o resto de um orçamento antigo não pode ser barrado por isso.
 *
 * As linhas são TRAVADAS (`FOR UPDATE`, em ordem fixa de id, para duas gravações com fornecedores em
 * comum não se prenderem uma à outra): arquivar um fornecedor ao mesmo tempo em que alguém o vincula
 * nunca deixa um vínculo novo com um arquivado. Chame DENTRO da transação, antes de gravar.
 */
export async function resolveSupplierLinks(
  tx: Prisma.TransactionClient,
  companyId: string,
  ids: ReadonlyArray<string | null | undefined>,
  alreadyLinked: ReadonlySet<string> = new Set()
): Promise<Map<string, string>> {
  // `undefined` também é "sem vínculo": quem chama o serviço direto pode omitir o campo (a API sempre manda `null`).
  const unique = [...new Set(ids.filter((id): id is string => typeof id === "string"))].sort();
  if (unique.length === 0) return new Map();

  await tx.$queryRaw`SELECT id FROM suppliers WHERE id IN (${Prisma.join(unique)}) AND "companyId" = ${companyId} ORDER BY id FOR UPDATE`;
  const found = await tx.supplier.findMany({ where: { id: { in: unique }, companyId }, select: { id: true, name: true, archivedAt: true } });
  const byId = new Map(found.map((supplier) => [supplier.id, supplier]));

  for (const id of unique) {
    const supplier = byId.get(id);
    if (!supplier) throw new AdminActionError("Fornecedor não encontrado.", 422);
    if (supplier.archivedAt && !alreadyLinked.has(id)) {
      throw new AdminActionError(`O fornecedor ${supplier.name} está arquivado. Reative-o ou escolha outro.`, 409);
    }
  }
  return new Map(found.map((supplier) => [supplier.id, supplier.name]));
}
