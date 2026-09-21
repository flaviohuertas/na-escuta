/**
 * Regras PURAS do financeiro do evento (custo REALIZADO): a comparação com o orçamento previsto
 * por categoria e o histórico em palavras. Sem banco e sem rede — servem ao servidor (que
 * decide) e às telas (que mostram). As categorias são as MESMAS do orçamento (`BUDGET_CATEGORIES`),
 * para que previsto e realizado se comparem linha a linha.
 */
import { BUDGET_CATEGORIES, categoryLabel } from "./budget";
import { formatBRL } from "./crm";
import { formatDateOnlyBR } from "./proposal";

export const MAX_EXPENSE_NOTES = 1000;
export const MAX_VOID_REASON = 500;
/** O motivo do estorno: pelo menos isto, para o histórico servir de alguma coisa. */
export const MIN_VOID_REASON_LENGTH = 3;

// ---------------------------------------------------------------------------
// Previsto × realizado
// ---------------------------------------------------------------------------

/**
 * Como uma categoria está em relação ao orçamento:
 * - `OVER`: há previsão e o realizado passou dela (estourou);
 * - `WITHIN`: há previsão e o realizado cabe nela (inclusive zero gasto);
 * - `UNPLANNED`: gastou-se sem nenhuma previsão para a categoria.
 */
export type ComparisonStatus = "OVER" | "WITHIN" | "UNPLANNED";

export interface CategoryComparison {
  category: string;
  /** Há uma linha de orçamento nesta categoria? */
  hasPlan: boolean;
  plannedCents: number;
  realizedCents: number;
  /** Realizado − previsto: positivo é gasto ACIMA do previsto. */
  varianceCents: number;
  /** Quanto do previsto já foi gasto, em pontos-base (10000 = 100%); `null` sem previsão. */
  consumedBps: number | null;
  status: ComparisonStatus;
}

export interface BudgetComparison {
  rows: CategoryComparison[];
  /** Existe algum orçamento previsto? Sem ele só há o realizado. */
  hasBudget: boolean;
  plannedTotalCents: number;
  realizedTotalCents: number;
  varianceTotalCents: number;
  consumedTotalBps: number | null;
}

/**
 * Compara o custo previsto (subtotais do orçamento) com o realizado (soma dos lançamentos ativos)
 * categoria a categoria. Uma categoria só com previsão, só com gasto ou com os dois aparece — e o
 * dinheiro gasto numa categoria SEM previsão nunca some (vira "sem previsão"). Ordem: a do
 * orçamento; categorias que não conhecemos por último.
 */
export function compareToBudget(
  planned: ReadonlyArray<{ category: string; subtotalCents: number }>,
  realized: ReadonlyArray<{ category: string; totalCents: number }>
): BudgetComparison {
  const plannedBy = new Map<string, number>();
  for (const line of planned) plannedBy.set(line.category, (plannedBy.get(line.category) ?? 0) + line.subtotalCents);
  const realizedBy = new Map<string, number>();
  for (const line of realized) realizedBy.set(line.category, (realizedBy.get(line.category) ?? 0) + line.totalCents);

  const known = BUDGET_CATEGORIES.map((category) => category.code as string);
  const unknown = [...new Set([...plannedBy.keys(), ...realizedBy.keys()])].filter((code) => !known.includes(code));
  const order = [...known, ...unknown].filter((code) => plannedBy.has(code) || realizedBy.has(code));

  const rows: CategoryComparison[] = order.map((category) => {
    const hasPlan = plannedBy.has(category);
    const plannedCents = plannedBy.get(category) ?? 0;
    const realizedCents = realizedBy.get(category) ?? 0;
    return {
      category,
      hasPlan,
      plannedCents,
      realizedCents,
      varianceCents: realizedCents - plannedCents,
      consumedBps: hasPlan && plannedCents > 0 ? Math.round((realizedCents * 10000) / plannedCents) : null,
      status: !hasPlan ? "UNPLANNED" : realizedCents > plannedCents ? "OVER" : "WITHIN",
    };
  });

  const plannedTotalCents = rows.reduce((sum, row) => sum + row.plannedCents, 0);
  const realizedTotalCents = rows.reduce((sum, row) => sum + row.realizedCents, 0);
  return {
    rows,
    hasBudget: plannedBy.size > 0,
    plannedTotalCents,
    realizedTotalCents,
    varianceTotalCents: realizedTotalCents - plannedTotalCents,
    consumedTotalBps: plannedTotalCents > 0 ? Math.round((realizedTotalCents * 10000) / plannedTotalCents) : null,
  };
}

export const COMPARISON_STATUS_LABEL: Record<ComparisonStatus, string> = {
  OVER: "Estourou",
  WITHIN: "Dentro do previsto",
  UNPLANNED: "Sem previsão",
};

// ---------------------------------------------------------------------------
// Histórico
// ---------------------------------------------------------------------------

const asRecord = (value: unknown): Record<string, unknown> => (value && typeof value === "object" ? (value as Record<string, unknown>) : {});

const EXPENSE_FIELD_LABEL: Array<[string, string]> = [
  ["category", "categoria"],
  ["description", "descrição"],
  ["supplier", "fornecedor"],
  ["expenseDate", "data"],
  ["notes", "observações"],
];

/**
 * Uma linha do histórico do financeiro, em palavras, a partir do que o servidor gravou na auditoria.
 * Ação desconhecida sai como veio — nunca some.
 */
export function describeExpenseHistory(action: string, before: unknown, after: unknown, metadata?: unknown): string {
  const b = asRecord(before);
  const a = asRecord(after);
  const m = asRecord(metadata);
  const what = typeof (a.description ?? b.description) === "string" ? String(a.description ?? b.description) : "lançamento";

  switch (action) {
    case "EXPENSE_CREATED": {
      const amount = typeof a.amountCents === "number" ? formatBRL(a.amountCents) : null;
      const detail = [typeof a.category === "string" ? categoryLabel(a.category) : null, amount].filter(Boolean).join(", ");
      return `Lançamento criado: ${what}${detail ? ` (${detail})` : ""}.`;
    }
    case "EXPENSE_UPDATED": {
      const changed: string[] = [];
      if (b.amountCents !== a.amountCents) {
        changed.push(
          typeof b.amountCents === "number" && typeof a.amountCents === "number"
            ? `valor (de ${formatBRL(b.amountCents)} para ${formatBRL(a.amountCents)})`
            : "valor"
        );
      }
      for (const [key, label] of EXPENSE_FIELD_LABEL) {
        if (JSON.stringify(b[key] ?? null) !== JSON.stringify(a[key] ?? null)) changed.push(label);
      }
      return changed.length > 0 ? `Lançamento editado (${what}): ${changed.join(", ")}.` : `Lançamento editado (${what}).`;
    }
    case "EXPENSE_VOIDED": {
      const reason = typeof m.reason === "string" && m.reason ? ` — ${m.reason}` : "";
      const amount = typeof b.amountCents === "number" ? ` (${formatBRL(b.amountCents)})` : "";
      return `Lançamento estornado: ${what}${amount}${reason}.`;
    }
    default:
      return action;
  }
}

/** A data do lançamento como a pessoa lê (dia do calendário, sem fuso). */
export const formatExpenseDate = formatDateOnlyBR;
