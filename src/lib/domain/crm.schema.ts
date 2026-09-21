import { z } from "zod";
import { uuid } from "./common.schema";
import { isValidDocument, MAX_VALUE_CENTS, MIN_LOST_REASON_LENGTH, OPPORTUNITY_STAGES, onlyDigits } from "./crm";
import { EventInputSchema } from "./event.schema";
import { EmailSchema } from "./team.schema";

/** Texto opcional: em branco vira "sem valor" (null), nunca uma string vazia gravada. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null));

/**
 * CPF/CNPJ opcional: aceita com ou sem máscara e devolve só os dígitos. Se veio, os dígitos
 * verificadores têm de conferir — um documento digitado errado não entra e depois "duplica" o cliente.
 */
export const optionalDocument = z
  .string()
  .trim()
  .nullish()
  .transform((value) => (value ? onlyDigits(value) : null))
  .refine((digits) => digits === null || isValidDocument(digits), { message: "CPF ou CNPJ inválido." });

export const optionalEmail = z
  .string()
  .trim()
  .nullish()
  .transform((value) => (value ? value : null))
  .pipe(z.union([z.null(), EmailSchema]));

// ---------------------------------------------------------------------------
// Clientes
// ---------------------------------------------------------------------------

export const ClientKindSchema = z.enum(["COMPANY", "PERSON"]);

export const ClientInputSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome do cliente.").max(200, "Nome longo demais."),
  kind: ClientKindSchema.default("COMPANY"),
  document: optionalDocument,
  email: optionalEmail,
  phone: optionalText(40),
  notes: optionalText(2000),
});
export type ClientInput = z.infer<typeof ClientInputSchema>;

/** Editar um cliente: a versão que a pessoa via ao abrir — se outra pessoa editou antes, 409. */
export const ClientUpdateSchema = ClientInputSchema.extend({ baseVersion: z.number().int().positive() });
export type ClientUpdateInput = z.infer<typeof ClientUpdateSchema>;

/** Arquivar/reativar (um cliente nunca é apagado). */
export const ClientArchiveSchema = z.object({ archived: z.boolean(), baseVersion: z.number().int().positive() });

// ---------------------------------------------------------------------------
// Oportunidades
// ---------------------------------------------------------------------------

export const OpportunityStageSchema = z.enum(OPPORTUNITY_STAGES);

const OpportunityFieldsSchema = z.object({
  clientId: uuid(),
  title: z.string().trim().min(2, "Informe o título da oportunidade.").max(200, "Título longo demais."),
  description: optionalText(4000),
  expectedValueCents: z
    .number()
    .int("O valor precisa estar em centavos.")
    .min(0, "O valor não pode ser negativo.")
    .max(MAX_VALUE_CENTS, "Valor acima do limite de R$ 20 milhões.")
    .nullish()
    .transform((value) => value ?? null),
  expectedStartDate: z.string().datetime().nullish().transform((value) => value ?? null),
  expectedEndDate: z.string().datetime().nullish().transform((value) => value ?? null),
  ownerUserId: uuid().nullish().transform((value) => value ?? null),
});

const endNotBeforeStart = {
  check: (data: { expectedStartDate: string | null; expectedEndDate: string | null }) =>
    !data.expectedStartDate || !data.expectedEndDate || new Date(data.expectedEndDate) >= new Date(data.expectedStartDate),
  options: { message: "A data de término não pode ser anterior à data de início", path: ["expectedEndDate"] },
};

export const OpportunityInputSchema = OpportunityFieldsSchema.refine(endNotBeforeStart.check, endNotBeforeStart.options);
export type OpportunityInput = z.infer<typeof OpportunityInputSchema>;

export const OpportunityUpdateSchema = OpportunityFieldsSchema.extend({ baseVersion: z.number().int().positive() }).refine(
  endNotBeforeStart.check,
  endNotBeforeStart.options
);
export type OpportunityUpdateInput = z.infer<typeof OpportunityUpdateSchema>;

/** Mover no funil. Perder exige o motivo. */
export const StageMoveSchema = z
  .object({
    stage: OpportunityStageSchema,
    lostReason: optionalText(500),
    baseVersion: z.number().int().positive(),
  })
  .refine((move) => move.stage !== "LOST" || (move.lostReason?.length ?? 0) >= MIN_LOST_REASON_LENGTH, {
    message: "Diga por que a oportunidade foi perdida.",
    path: ["lostReason"],
  });
export type StageMoveInput = z.infer<typeof StageMoveSchema>;

/** Transformar a oportunidade em evento: os dados do evento + a versão da oportunidade que a pessoa via. */
export const ConvertToEventSchema = z.object({
  event: EventInputSchema,
  baseVersion: z.number().int().positive(),
});
export type ConvertToEventInput = z.infer<typeof ConvertToEventSchema>;
