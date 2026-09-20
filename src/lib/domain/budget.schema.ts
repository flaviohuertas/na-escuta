import { z } from "zod";
import { MAX_VALUE_CENTS } from "./crm";
import { optionalText } from "./crm.schema";
import {
  BUDGET_CATEGORY_CODES,
  MAX_BUDGET_ITEMS,
  MAX_ITEM_DESCRIPTION,
  MAX_NOTES,
  MAX_QUANTITY,
  MAX_SUPPLIER,
  budgetProblems,
} from "./budget";

/**
 * Estritos como os das propostas: campo desconhecido (um `totalCents` "já calculado", por exemplo)
 * leva 422 em vez de ser ignorado em silêncio. O total do orçamento nunca vem do cliente.
 */
export const BudgetItemSchema = z.strictObject({
  category: z.enum(BUDGET_CATEGORY_CODES, { error: "Escolha a categoria do item." }),
  description: z.string().trim().min(2, "Descreva o item.").max(MAX_ITEM_DESCRIPTION, "Descrição longa demais."),
  quantity: z
    .number()
    .int("A quantidade precisa ser um número inteiro.")
    .min(1, "A quantidade mínima é 1.")
    .max(MAX_QUANTITY, `A quantidade máxima é ${MAX_QUANTITY}.`),
  unitCostCents: z
    .number()
    .int("O custo precisa estar em centavos.")
    .min(0, "O custo não pode ser negativo.")
    .max(MAX_VALUE_CENTS, "Custo acima do limite de R$ 20 milhões."),
  supplier: optionalText(MAX_SUPPLIER),
});
export type BudgetItemInput = z.infer<typeof BudgetItemSchema>;

/**
 * Salvar o orçamento (cria na primeira vez, edita depois): a lista INTEIRA de itens + as premissas +
 * a versão que a pessoa via (`0` = "ainda não existia"). Se outra pessoa salvou antes, 409.
 */
export const BudgetSaveSchema = z
  .strictObject({
    items: z.array(BudgetItemSchema).min(1, "Inclua ao menos um item.").max(MAX_BUDGET_ITEMS, `No máximo ${MAX_BUDGET_ITEMS} itens.`),
    notes: optionalText(MAX_NOTES),
    baseVersion: z.number().int().min(0),
  })
  .superRefine((data, ctx) => {
    for (const problem of budgetProblems(data.items)) {
      ctx.addIssue({ code: "custom", message: problem.message, path: problem.path });
    }
  });
export type BudgetSaveInput = z.infer<typeof BudgetSaveSchema>;
