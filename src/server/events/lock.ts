import type { Prisma } from "@/generated/prisma/client";

/**
 * Serializa as mudanças de acesso DE UM EVENTO: sem isso, dois gestores tirando-se um ao outro no
 * mesmo instante passam os dois pela trava "nunca ficar sem gestor" e o evento fica órfão.
 * Um `SELECT … FOR UPDATE` na linha do evento faz o segundo esperar o commit do primeiro.
 *
 * Quem trava VÁRIOS eventos na mesma transação deve fazê-lo em ordem crescente de id, para duas
 * transações nunca se esperarem em círculo.
 */
export async function lockEvent(tx: Prisma.TransactionClient, eventId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM events WHERE id = ${eventId} FOR UPDATE`;
}
