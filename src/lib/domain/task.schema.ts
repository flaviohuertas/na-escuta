import { z } from "zod";
import { SyncMetaSchema, uuid } from "./common.schema";

export const TaskStatusValues = ["TODO", "IN_PROGRESS", "DONE", "BLOCKED"] as const;
export const TaskStatusSchema = z.enum(TaskStatusValues);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskInputSchema = z.object({
  eventId: uuid(),
  title: z.string().trim().min(1, "Informe o título da tarefa").max(200),
  description: z.string().trim().max(4000).optional().nullable(),
  status: TaskStatusSchema.default("TODO"),
  priority: z.number().int().min(0).max(3).default(0),
  dueAt: z.string().datetime().optional().nullable(),
  assignedToUserId: uuid().optional().nullable(),
});

export const TaskEntitySchema = z
  .object({
    id: uuid(),
    companyId: uuid(),
  })
  .merge(TaskInputSchema)
  .merge(SyncMetaSchema);

/** Forma aceita ao chamar o repositório (campos com default() ficam opcionais). */
export type TaskInput = z.input<typeof TaskInputSchema>;
/** Forma já normalizada após `.parse()` (defaults resolvidos). */
export type TaskParsed = z.infer<typeof TaskInputSchema>;
export type TaskEntity = z.infer<typeof TaskEntitySchema>;
