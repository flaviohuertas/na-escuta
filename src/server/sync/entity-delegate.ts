import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { SyncEntityType } from "@/lib/sync/protocol";

type QueryClient = PrismaClient | Prisma.TransactionClient;

/**
 * Dispatch genérico para o delegate Prisma certo (Task/ChecklistTemplate/
 * ChecklistItem/Occurrence/OccurrenceEvidence). Os 5 tipos têm shapes
 * diferentes; a segurança de tipo real vem da validação Zod no boundary de
 * cada operação (SCHEMA_BY_ENTITY em push.service.ts) — este `any` só
 * destrava o dispatch dinâmico, compartilhado entre push/pull/conflitos para
 * não repetir o mesmo switch em três arquivos.
 */
export function delegateFor(client: QueryClient, entityType: SyncEntityType): any {
  switch (entityType) {
    case "Task":
      return client.task;
    case "ChecklistTemplate":
      return client.checklistTemplate;
    case "ChecklistItem":
      return client.checklistItem;
    case "Occurrence":
      return client.occurrence;
    case "OccurrenceEvidence":
      return client.occurrenceEvidence;
  }
}
