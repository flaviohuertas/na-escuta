import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";

/**
 * O JWT de sessão não é revogável por si só: continua assinado e "válido" até expirar, mesmo depois
 * de a senha ser redefinida ou o vínculo encerrado. Este contador fecha isso — o token guarda a
 * versão do momento do login e a sessão só vale enquanto ela for igual à do banco.
 */

/** A versão atual das sessões da pessoa, ou `null` se a conta não existe ou foi desativada. */
export async function readSessionVersion(userId: string): Promise<number | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isActive: true, sessionVersion: true } });
  if (!user || !user.isActive) return null;
  return user.sessionVersion;
}

/**
 * A sessão ainda vale? Conta inexistente ou desativada e versão diferente da do banco derrubam a
 * sessão. Token emitido antes desta regra existir não tem versão: conta como 0, a versão inicial
 * de toda conta — ninguém é deslogado à toa no deploy, e o primeiro `bump` derruba esse token.
 */
export async function isSessionCurrent(userId: unknown, tokenVersion: unknown): Promise<boolean> {
  if (typeof userId !== "string") return false;
  const current = await readSessionVersion(userId);
  if (current === null) return false;
  return current === (typeof tokenVersion === "number" ? tokenVersion : 0);
}

/**
 * Derruba todas as sessões abertas da pessoa (sobe a versão). Recebe o cliente da transação de
 * quem chama, para a derrubada valer junto com a mudança que a motivou — ou nenhuma das duas.
 * Devolve a nova versão.
 */
export async function bumpSessionVersion(
  db: Pick<Prisma.TransactionClient, "user">,
  userId: string
): Promise<number> {
  const updated = await db.user.update({
    where: { id: userId },
    data: { sessionVersion: { increment: 1 } },
    select: { sessionVersion: true },
  });
  return updated.sessionVersion;
}
