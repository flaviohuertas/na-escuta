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

const EventFieldsSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome do evento").max(200),
  description: z.string().trim().max(4000).optional().nullable(),
  location: z.string().trim().max(300).optional().nullable(),
  startDate: z.string().datetime({ message: "Informe a data de início" }),
  endDate: z.string().datetime({ message: "Informe a data de término" }),
  status: EventStatusSchema.default("PLANNED"),
});

const endNotBeforeStart = {
  check: (data: { startDate: string; endDate: string }) =>
    new Date(data.endDate) >= new Date(data.startDate),
  options: {
    message: "A data de término não pode ser anterior à data de início",
    path: ["endDate"],
  },
};

export const EventInputSchema = EventFieldsSchema.refine(endNotBeforeStart.check, endNotBeforeStart.options);

/**
 * Edição de um evento existente. `baseVersion` é a versão que a pessoa estava vendo ao abrir o
 * formulário: se o evento mudou nesse meio-tempo, o servidor recusa (409) em vez de sobrescrever
 * em silêncio a edição de outra pessoa.
 */
export const EventUpdateInputSchema = EventFieldsSchema.extend({
  baseVersion: z.number().int().positive(),
}).refine(endNotBeforeStart.check, endNotBeforeStart.options);

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
export type EventUpdateParsed = z.infer<typeof EventUpdateInputSchema>;
export type EventEntity = z.infer<typeof EventEntitySchema>;
