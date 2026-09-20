import { z } from "zod";
import { uuid } from "./common.schema";
import { MAX_VALUE_CENTS } from "./crm";
import { optionalText } from "./crm.schema";
import {
  MAX_DECISION_NOTE,
  MAX_ITEMS,
  MAX_ITEM_DESCRIPTION,
  MAX_NOTES,
  MAX_QUANTITY,
  isValidDateOnly,
  totalsProblems,
} from "./proposal";

/**
 * Os schemas são ESTRITOS: quem manda um campo que não existe (um `totalCents` "já calculado", por
 * exemplo) leva 422 em vez de ter o campo ignorado em silêncio. Os totais nunca vêm do cliente — o
 * servidor calcula a partir dos itens.
 */
export const ProposalItemSchema = z.strictObject({
  description: z.string().trim().min(2, "Descreva o item.").max(MAX_ITEM_DESCRIPTION, "Descrição longa demais."),
  quantity: z
    .number()
    .int("A quantidade precisa ser um número inteiro.")
    .min(1, "A quantidade mínima é 1.")
    .max(MAX_QUANTITY, `A quantidade máxima é ${MAX_QUANTITY}.`),
  unitPriceCents: z
    .number()
    .int("O preço precisa estar em centavos.")
    .min(0, "O preço não pode ser negativo.")
    .max(MAX_VALUE_CENTS, "Preço acima do limite de R$ 20 milhões."),
});
export type ProposalItemInput = z.infer<typeof ProposalItemSchema>;

/** Um dia do calendário ("2027-01-10"), que exista de verdade. */
const DateOnlySchema = z.string().refine(isValidDateOnly, "Data inválida.");

const ProposalFieldsSchema = z.strictObject({
  items: z.array(ProposalItemSchema).min(1, "Inclua ao menos um item.").max(MAX_ITEMS, `No máximo ${MAX_ITEMS} itens.`),
  discountCents: z
    .number()
    .int("O desconto precisa estar em centavos.")
    .min(0, "O desconto não pode ser negativo.")
    .max(MAX_VALUE_CENTS, "Desconto acima do limite de R$ 20 milhões.")
    .default(0),
  /** O último dia em que a proposta vale. Pode faltar num rascunho; para ENVIAR é obrigatória. */
  validUntil: DateOnlySchema.nullish().transform((value) => value ?? null),
  notes: optionalText(MAX_NOTES),
});

function checkTotals(data: { items: Array<{ quantity: number; unitPriceCents: number }>; discountCents: number }, ctx: z.RefinementCtx) {
  for (const problem of totalsProblems(data.items, data.discountCents)) {
    ctx.addIssue({ code: "custom", message: problem.message, path: problem.path });
  }
}

/**
 * Criar uma proposta (um rascunho). `copiedFromProposalId` só registra de qual versão ela partiu
 * (o servidor confere que é da mesma oportunidade).
 */
export const ProposalInputSchema = ProposalFieldsSchema.extend({
  copiedFromProposalId: uuid().nullish().transform((value) => value ?? null),
}).superRefine(checkTotals);
export type ProposalInput = z.infer<typeof ProposalInputSchema>;

/** Editar o rascunho: a versão que a pessoa via ao abrir — se outra pessoa mexeu antes, 409. */
export const ProposalUpdateSchema = ProposalFieldsSchema.extend({ baseVersion: z.number().int().positive() }).superRefine(checkTotals);
export type ProposalUpdateInput = z.infer<typeof ProposalUpdateSchema>;

export const PROPOSAL_ACTION_NAMES = ["SEND", "ACCEPT", "REJECT", "DISCARD"] as const;

/**
 * Mudar a situação da proposta. `note` (opcional) só vale para aceitar/recusar — o que o cliente
 * disse; nas outras ações é ignorado.
 */
export const ProposalActionSchema = z.strictObject({
  action: z.enum(PROPOSAL_ACTION_NAMES),
  baseVersion: z.number().int().positive(),
  note: optionalText(MAX_DECISION_NOTE),
});
export type ProposalActionInput = z.infer<typeof ProposalActionSchema>;
