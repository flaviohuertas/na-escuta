import type { Event } from "@/generated/prisma/client";
import type { EventSnapshot } from "@/lib/sync/protocol";

/**
 * O evento que vai para o aparelho: no bootstrap (primeira preparação) e em TODO pull, para
 * que uma edição feita depois (nome, datas, status) chegue a quem já preparou o evento.
 */
export function toEventSnapshot(event: Event): EventSnapshot {
  return {
    id: event.id,
    companyId: event.companyId,
    name: event.name,
    description: event.description,
    location: event.location,
    startDate: event.startDate.toISOString(),
    endDate: event.endDate.toISOString(),
    status: event.status,
    version: event.version,
    updatedAt: event.updatedAt.toISOString(),
  };
}
