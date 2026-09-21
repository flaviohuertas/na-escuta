import { z } from "zod";
import { BUDGET_CATEGORY_CODES, MAX_ITEM_DESCRIPTION, MAX_SUPPLIER } from "./budget";
import { MAX_VALUE_CENTS } from "./crm";
import { optionalText } from "./crm.schema";
import { MAX_EXPENSE_NOTES, MAX_VOID_REASON, MIN_VOID_REASON_LENGTH } from "./finance";
import { DateOnlySchema } from "./proposal.schema";

/**
 * Estritos como os do orçamento e das propostas: campo desconhecido leva 422 em vez de ser ignorado
 * em silêncio (quem, por exemplo, tentasse mandar `voidedAt` na criação). O valor é sempre em
 * centavos e maior que zero — dinheiro que volta é ESTORNO, não valor negativo.
 */
const ExpenseFieldsSchema = z.strictObject({
  category: z.enum(BUDGET_CATEGORY_CODES, { error: "Escolha a categoria." }),
  description: z.string().trim().min(2, "Descreva o lançamento.").max(MAX_ITEM_DESCRIPTION, "Descrição longa demais."),
  supplier: optionalText(MAX_SUPPLIER),
  amountCents: z
    .number()
    .int("O valor precisa estar em centavos.")
    .min(1, "O valor precisa ser maior que zero.")
    .max(MAX_VALUE_CENTS, "Valor acima do limite de R$ 20 milhões."),
  /** O dia em que o custo aconteceu ("2027-01-10"), um dia que exista de verdade. */
  expenseDate: DateOnlySchema,
  notes: optionalText(MAX_EXPENSE_NOTES),
});

export const ExpenseInputSchema = ExpenseFieldsSchema;
export type ExpenseInput = z.infer<typeof ExpenseInputSchema>;

/** Editar um lançamento: a versão que a pessoa via — se outra pessoa mexeu antes, 409. */
export const ExpenseUpdateSchema = ExpenseFieldsSchema.extend({ baseVersion: z.number().int().positive() });
export type ExpenseUpdateInput = z.infer<typeof ExpenseUpdateSchema>;

/** Estornar exige o motivo (o lançamento continua na lista, riscado, e sai dos totais). */
export const ExpenseVoidSchema = z.strictObject({
  reason: z.string().trim().min(MIN_VOID_REASON_LENGTH, "Diga por que o lançamento foi estornado.").max(MAX_VOID_REASON, "Motivo longo demais."),
  baseVersion: z.number().int().positive(),
});
export type ExpenseVoidInput = z.infer<typeof ExpenseVoidSchema>;
