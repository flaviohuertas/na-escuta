import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { AccessStatus } from "@/generated/prisma/enums";

/**
 * Os eventos que a pessoa enxerga: `EventAccess` ATIVO *e* vínculo ATIVO com a empresa dona do
 * evento (mesma regra de `authorizeEventAccess`) — um vínculo revogado esconde os eventos mesmo
 * que o acesso ao evento tenha ficado para trás. Única definição, usada pelo catálogo, pelo Painel
 * e pelo cabeçalho do evento ainda não preparado.
 */
function accessibleWhere(userId: string): Prisma.EventAccessWhereInput {
  return {
    userId,
    status: AccessStatus.ACTIVE,
    user: { isActive: true },
    event: {
      deletedAt: null,
      company: { memberships: { some: { userId, status: AccessStatus.ACTIVE } } },
    },
  };
}

export function listAccessibleEvents(userId: string) {
  return prisma.eventAccess.findMany({
    where: accessibleWhere(userId),
    include: { event: true },
    orderBy: { event: { startDate: "asc" } },
  });
}

/** Um evento, pela mesma regra; `null` se a pessoa não o enxerga. */
export function findAccessibleEvent(userId: string, eventId: string) {
  return prisma.eventAccess.findFirst({
    where: { ...accessibleWhere(userId), eventId },
    include: { event: true },
  });
}
