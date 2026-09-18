import { z } from "zod";
import { SyncMetaSchema, uuid } from "./common.schema";

export const ChecklistItemStatusValues = ["PENDING", "DONE", "NOT_APPLICABLE"] as const;
export const ChecklistItemStatusSchema = z.enum(ChecklistItemStatusValues);
export type ChecklistItemStatus = z.infer<typeof ChecklistItemStatusSchema>;

export const ChecklistTemplateInputSchema = z.object({
  eventId: uuid(),
  title: z.string().trim().min(1, "Informe o título do checklist").max(200),
  description: z.string().trim().max(4000).optional().nullable(),
});

export const ChecklistTemplateEntitySchema = z
  .object({ id: uuid(), companyId: uuid() })
  .merge(ChecklistTemplateInputSchema)
  .merge(SyncMetaSchema);

export const ChecklistItemInputSchema = z.object({
  checklistId: uuid(),
  eventId: uuid(),
  label: z.string().trim().min(1, "Informe o texto do item").max(300),
  order: z.number().int().min(0).default(0),
  isRequired: z.boolean().default(false),
  status: ChecklistItemStatusSchema.default("PENDING"),
  doneAt: z.string().datetime().optional().nullable(),
  doneByUserId: uuid().optional().nullable(),
});

export const ChecklistItemEntitySchema = z
  .object({ id: uuid(), companyId: uuid() })
  .merge(ChecklistItemInputSchema)
  .merge(SyncMetaSchema);

export type ChecklistTemplateInput = z.input<typeof ChecklistTemplateInputSchema>;
export type ChecklistTemplateParsed = z.infer<typeof ChecklistTemplateInputSchema>;
export type ChecklistTemplateEntity = z.infer<typeof ChecklistTemplateEntitySchema>;
export type ChecklistItemInput = z.input<typeof ChecklistItemInputSchema>;
export type ChecklistItemParsed = z.infer<typeof ChecklistItemInputSchema>;
export type ChecklistItemEntity = z.infer<typeof ChecklistItemEntitySchema>;
