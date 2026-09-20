import { z } from "zod";
import { PROPOSABLE_EVENT_FIELDS } from "./approval";
import { uuid } from "./common.schema";
import { EventStatusSchema } from "./event.schema";

/** O tipo de proposta (`PendingApproval.entityType`) da correção dos dados de um evento. */
export const EVENT_CHANGE_ENTITY_TYPE = "Event";

/** Quantas propostas a mesma pessoa pode ter esperando decisão no mesmo evento (barra spam e proposta em rajada). */
export const MAX_PENDING_PER_PERSON_PER_EVENT = 5;

/**
 * O que a pessoa quer mudar no evento. `strict`: qualquer campo fora da lista (versão, empresa,
 * `deletedAt`…) é recusado em vez de ignorado — uma proposta nunca carrega o que não devia mexer.
 * Só os campos presentes mudam; o que não vem, fica como está.
 */
export const EventChangesSchema = z
  .strictObject({
    name: z.string().trim().min(1, "Informe o nome do evento").max(200).optional(),
    description: z.string().trim().max(4000).nullable().optional(),
    location: z.string().trim().max(300).nullable().optional(),
    startDate: z.string().datetime({ message: "Informe a data de início" }).optional(),
    endDate: z.string().datetime({ message: "Informe a data de término" }).optional(),
    status: EventStatusSchema.optional(),
  })
  .refine((changes) => Object.values(changes).some((value) => value !== undefined), {
    message: "Escolha pelo menos um campo para corrigir.",
  })
  .refine(
    (changes) => !(changes.startDate && changes.endDate) || new Date(changes.endDate) >= new Date(changes.startDate),
    { message: "A data de término não pode ser anterior à data de início", path: ["endDate"] }
  );

export const ProposeEventChangeSchema = z.object({
  eventId: uuid(),
  changes: EventChangesSchema,
  /** Por que corrigir — ajuda quem decide. */
  reason: z.string().trim().max(1000).nullish(),
});
export type ProposeEventChangeInput = z.infer<typeof ProposeEventChangeSchema>;

/** Rejeitar exige dizer por quê: quem propôs precisa saber o que corrigir na próxima. */
export const ReviewDecisionSchema = z
  .object({
    decision: z.enum(["APPROVE", "REJECT"]),
    notes: z.string().trim().max(1000).nullish(),
  })
  .refine((review) => review.decision !== "REJECT" || (review.notes?.length ?? 0) >= 3, {
    message: "Explique o motivo da rejeição para quem propôs.",
    path: ["notes"],
  });
export type ReviewDecisionInput = z.infer<typeof ReviewDecisionSchema>;

const StoredValues = z.partialRecord(z.enum(PROPOSABLE_EVENT_FIELDS), z.string().nullable());

/**
 * O formato guardado em `PendingApproval.proposedChangeJson` para este tipo. Lido de volta com
 * este schema: uma proposta com JSON que não confere (corrompida, de versão futura) nunca é aplicada.
 */
export const StoredEventChangeSchema = z.object({
  /** A versão do evento quando a proposta foi feita. */
  baseVersion: z.number().int().positive(),
  /** Os valores que a pessoa via, nos campos que propõe mudar. */
  before: StoredValues,
  /** Os valores propostos (normalizados como o servidor os grava). */
  after: StoredValues,
  reason: z.string().nullable(),
});
export type StoredEventChange = z.infer<typeof StoredEventChangeSchema>;
