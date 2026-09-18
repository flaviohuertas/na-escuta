import { z } from "zod";
import { SyncMetaSchema, uuid } from "./common.schema";

export const EventStatusValues = [
  "PLANNED",
  "CONFIRMED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
] as const;
export const EventStatusSchema = z.enum(EventStatusValues);
export type EventStatus = z.infer<typeof EventStatusSchema>;

export const EventInputSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome do evento").max(200),
  description: z.string().trim().max(4000).optional().nullable(),
  location: z.string().trim().max(300).optional().nullable(),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  status: EventStatusSchema.default("PLANNED"),
}).refine((data) => new Date(data.endDate) >= new Date(data.startDate), {
  message: "A data de término não pode ser anterior à data de início",
  path: ["endDate"],
});

export const EventEntitySchema = z.object({
  id: uuid(),
  companyId: uuid(),
  name: z.string(),
  description: z.string().nullable(),
  location: z.string().nullable(),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  status: EventStatusSchema,
}).merge(SyncMetaSchema);

export type EventInput = z.input<typeof EventInputSchema>;
export type EventParsed = z.infer<typeof EventInputSchema>;
export type EventEntity = z.infer<typeof EventEntitySchema>;
