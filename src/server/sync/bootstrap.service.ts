import { prisma } from "@/lib/db/prisma";
import type { BootstrapResponse, SyncEntityType } from "@/lib/sync/protocol";
import { authorizeEventAccess } from "./authorize";
import { delegateFor } from "./entity-delegate";
import { toEventSnapshot } from "./event-snapshot";
import { pullChangesForEvent } from "./pull.service";

const COUNTED_TYPES: SyncEntityType[] = [
  "Task",
  "ChecklistTemplate",
  "ChecklistItem",
  "Occurrence",
  "OccurrenceEvidence",
];

export class EventAccessDeniedError extends Error {
  constructor(public reason: string) {
    super(`Acesso ao evento negado: ${reason}`);
    this.name = "EventAccessDeniedError";
  }
}

/**
 * Manifesto + primeira página de dados para "preparar evento para uso
 * offline". `counts` dá ao cliente o total esperado por tipo de entidade,
 * usado para mostrar progresso e para VERIFICAR ao final que tudo que
 * deveria ter sido baixado realmente está no IndexedDB (não só "terminou
 * sem erro" — conta registro por registro).
 *
 * Nesta fatia o pacote "preparado" cobre Evento + Tarefas + Checklists +
 * Ocorrências (+ metadados de evidência). Contatos e documentos citados no
 * enunciado entram quando os módulos de CRM e Documentos existirem — o
 * mecanismo (este bootstrap + a paginação incremental de pull.service) já
 * está pronto para incluí-los sem mudança estrutural.
 */
export async function bootstrapEvent(
  eventId: string,
  ctx: { userId: string }
): Promise<BootstrapResponse> {
  const auth = await authorizeEventAccess(ctx, eventId);
  if (!auth.allowed) {
    throw new EventAccessDeniedError(auth.reason ?? "FORBIDDEN");
  }

  const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });

  const counts: Record<string, number> = { Event: 1 };
  for (const entityType of COUNTED_TYPES) {
    const delegate = delegateFor(prisma, entityType);
    counts[entityType] = await delegate.count({ where: { eventId, deletedAt: null } });
  }

  const firstPage = await pullChangesForEvent(eventId, null, ctx);

  return {
    manifest: {
      eventId,
      cursor: firstPage.nextCursor,
      counts,
      serverTime: firstPage.serverTime,
    },
    event: toEventSnapshot(event),
    changes: firstPage.changes,
  };
}
