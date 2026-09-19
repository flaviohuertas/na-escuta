import { prisma } from "@/lib/db/prisma";
import { AccessStatus } from "@/generated/prisma/enums";

/**
 * Os eventos que a pessoa enxerga: `EventAccess` ATIVO *e* vínculo ATIVO com a empresa dona do
 * evento (mesma regra de `authorizeEventAccess`) — um vínculo revogado esconde os eventos mesmo
 * que o acesso ao evento tenha ficado para trás. Única definição, usada pelo catálogo e pelo Painel.
 */
export function listAccessibleEvents(userId: string) {
  return prisma.eventAccess.findMany({
    where: {
      userId,
      status: AccessStatus.ACTIVE,
      event: {
        deletedAt: null,
        company: { memberships: { some: { userId, status: AccessStatus.ACTIVE } } },
      },
    },
    include: { event: true },
    orderBy: { event: { startDate: "asc" } },
  });
}
