import type { z } from "zod";
import { TaskInputSchema } from "@/lib/domain/task.schema";
import { ChecklistItemInputSchema, ChecklistTemplateInputSchema } from "@/lib/domain/checklist.schema";
import { OccurrenceEvidenceInputSchema, OccurrenceInputSchema } from "@/lib/domain/occurrence.schema";
import type { SyncEntityType } from "@/lib/sync/protocol";

/**
 * Schema de entrada por tipo de entidade sincronizável. É o filtro que separa o que o
 * dispositivo manda (o objeto local inteiro, com `syncStatus`, `createdAt` etc.) do que o
 * servidor de fato aplica: o Zod descarta chaves desconhecidas. TODO caminho que escreve um
 * payload vindo de cliente (push, resolução de conflito) passa por aqui — aplicar o payload
 * cru no Prisma falha com "Unknown argument" para campos que só existem no dispositivo.
 */
export const SCHEMA_BY_ENTITY: Record<SyncEntityType, z.ZodTypeAny> = {
  Task: TaskInputSchema,
  ChecklistTemplate: ChecklistTemplateInputSchema,
  ChecklistItem: ChecklistItemInputSchema,
  Occurrence: OccurrenceInputSchema,
  OccurrenceEvidence: OccurrenceEvidenceInputSchema,
};
