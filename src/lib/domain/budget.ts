/**
 * Regras PURAS do orçamento interno: as categorias de custo, os totais (sempre em centavos
 * inteiros), qual receita serve de referência para a margem, a margem em si, quando dá para editar
 * e o histórico em palavras. Sem banco e sem rede — servem ao servidor (que decide) e às telas
 * (que mostram).
 */
import { MAX_VALUE_CENTS, formatBRL, isOpenStage } from "./crm";
import { MAX_ITEM_DESCRIPTION, MAX_NOTES, MAX_QUANTITY } from "./proposal";

export { MAX_ITEM_DESCRIPTION, MAX_NOTES, MAX_QUANTITY };

// ---------------------------------------------------------------------------
// Categorias
// ---------------------------------------------------------------------------

/** As categorias de custo, na ordem em que aparecem. O código é o que se grava; o rótulo é o que se lê. */
export const BUDGET_CATEGORIES = [
  { code: "STRUCTURE", label: "Estrutura e palco" },
  { code: "AV", label: "Som, luz e imagem" },
  { code: "FOOD", label: "Alimentação e bebidas" },
  { code: "STAFF", label: "Equipe e mão de obra" },
  { code: "SECURITY", label: "Segurança e brigada" },
  { code: "LOGISTICS", label: "Logística e transporte" },
  { code: "VENUE", label: "Locação de espaço" },
  { code: "MARKETING", label: "Divulgação e comunicação" },
  { code: "PERMITS", label: "Licenças e taxas" },
  { code: "OTHER", label: "Outros" },
] as const;

export type BudgetCategoryCode = (typeof BUDGET_CATEGORIES)[number]["code"];

export const BUDGET_CATEGORY_CODES = BUDGET_CATEGORIES.map((category) => category.code) as [BudgetCategoryCode, ...BudgetCategoryCode[]];

/** O rótulo de um código; um código que não conhecemos (categoria futura) aparece como veio — nunca some. */
export function categoryLabel(code: string): string {
  return BUDGET_CATEGORIES.find((category) => category.code === code)?.label ?? code;
}

export const MAX_BUDGET_ITEMS = 200;
export const MAX_SUPPLIER = 120;

// ---------------------------------------------------------------------------
// Totais
// ---------------------------------------------------------------------------

export interface BudgetLine {
  category: string;
  quantity: number;
  unitCostCents: number;
}

export interface CategorySubtotal {
  category: string;
  subtotalCents: number;
  itemCount: number;
}

export interface BudgetTotals {
  /** O total de cada item (quantidade × custo unitário), na ordem dos itens. */
  lineTotals: number[];
  totalCents: number;
  /** Por categoria, na ordem de `BUDGET_CATEGORIES` (as desconhecidas por último); só as que têm item. */
  byCategory: CategorySubtotal[];
}

/**
 * Os totais do orçamento, em centavos inteiros: cada item = quantidade × custo; total = soma dos
 * itens; e o subtotal de cada categoria. É a ÚNICA conta — o servidor lê o que sai daqui e a tela
 * mostra o mesmo número enquanto a pessoa digita. Não valida (veja `budgetProblems`).
 */
export function computeBudgetTotals(items: readonly BudgetLine[]): BudgetTotals {
  const lineTotals = items.map((item) => item.quantity * item.unitCostCents);
  const perCategory = new Map<string, CategorySubtotal>();
  items.forEach((item, index) => {
    const current = perCategory.get(item.category) ?? { category: item.category, subtotalCents: 0, itemCount: 0 };
    current.subtotalCents += lineTotals[index]!;
    current.itemCount += 1;
    perCategory.set(item.category, current);
  });

  const known = BUDGET_CATEGORIES.map((category) => perCategory.get(category.code)).filter((entry): entry is CategorySubtotal => entry !== undefined);
  const unknown = [...perCategory.values()].filter((entry) => !BUDGET_CATEGORIES.some((category) => category.code === entry.category));
  return {
    lineTotals,
    totalCents: lineTotals.reduce((sum, line) => sum + line, 0),
    byCategory: [...known, ...unknown],
  };
}

export interface BudgetProblem {
  path: Array<string | number>;
  message: string;
}

/** O que está errado nos valores: um item ou o total acima do teto de R$ 20 milhões. */
export function budgetProblems(items: readonly BudgetLine[]): BudgetProblem[] {
  const problems: BudgetProblem[] = [];
  let total = 0;
  items.forEach((item, index) => {
    const line = item.quantity * item.unitCostCents;
    if (line > MAX_VALUE_CENTS) {
      problems.push({ path: ["items", index, "unitCostCents"], message: "O total deste item passa do limite de R$ 20 milhões." });
    }
    total += line;
  });
  if (total > MAX_VALUE_CENTS) {
    problems.push({ path: ["items"], message: "O custo total do orçamento passa do limite de R$ 20 milhões." });
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Receita de referência e margem
// ---------------------------------------------------------------------------

export interface ProposalRevenue {
  number: number;
  status: string;
  totalCents: number;
}

export type RevenueKind = "ACCEPTED" | "SENT" | "DRAFT" | "ESTIMATE";

export interface RevenueReference {
  kind: RevenueKind;
  cents: number;
  /** De onde veio o número, em palavras ("Proposta v2 (aceita)"). */
  label: string;
  proposalNumber: number | null;
}

/**
 * Contra qual receita se calcula a margem — sempre a mais firme que existe: a proposta ACEITA; senão
 * a ENVIADA; senão o RASCUNHO mais novo; senão o valor ESTIMADO da oportunidade; senão nenhuma.
 * Recusadas e substituídas não contam (não são o que se vai cobrar). A tela diz de onde veio o
 * número, para ninguém confundir uma estimativa com um preço fechado.
 */
export function pickRevenueReference(proposals: readonly ProposalRevenue[], expectedValueCents: number | null): RevenueReference | null {
  const newest = (status: string) => [...proposals].filter((p) => p.status === status).sort((a, b) => b.number - a.number)[0];

  const accepted = newest("ACCEPTED");
  if (accepted) return { kind: "ACCEPTED", cents: accepted.totalCents, label: `Proposta v${accepted.number} (aceita)`, proposalNumber: accepted.number };
  const sent = newest("SENT");
  if (sent) return { kind: "SENT", cents: sent.totalCents, label: `Proposta v${sent.number} (enviada)`, proposalNumber: sent.number };
  const draft = newest("DRAFT");
  if (draft) return { kind: "DRAFT", cents: draft.totalCents, label: `Proposta v${draft.number} (rascunho)`, proposalNumber: draft.number };
  if (expectedValueCents !== null) return { kind: "ESTIMATE", cents: expectedValueCents, label: "Valor estimado da oportunidade", proposalNumber: null };
  return null;
}

export interface Margin {
  /** Receita − custo; negativa é prejuízo. */
  marginCents: number;
  /** Margem sobre a receita em pontos-base (10000 = 100%), arredondada; `null` se a receita é zero. */
  marginBps: number | null;
}

export function computeMargin(revenueCents: number, costCents: number): Margin {
  const marginCents = revenueCents - costCents;
  return { marginCents, marginBps: revenueCents > 0 ? Math.round((marginCents * 10000) / revenueCents) : null };
}

const PERCENT = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Pontos-base como a pessoa lê: 3333 → "33,3%". */
export function formatBps(bps: number): string {
  return `${PERCENT.format(bps / 100)}%`;
}

// ---------------------------------------------------------------------------
// Quando dá para editar
// ---------------------------------------------------------------------------

/**
 * Por que o orçamento NÃO pode ser editado agora — ou `null` se pode. Editável enquanto a
 * oportunidade está em andamento ou ganha (antes de virar evento: ajustar o custo ao fechar é
 * normal); perdida não se mexe (reabra), e depois de virar evento o custo real é assunto do
 * financeiro, não deste plano.
 */
export function explainBlockedBudgetEdit(ctx: { oppStage: string; hasEvent: boolean }): string | null {
  if (ctx.hasEvent) return "Esta oportunidade já virou um evento: o orçamento fica só para consulta.";
  if (ctx.oppStage === "LOST") return "Esta oportunidade está perdida. Reabra-a para mexer no orçamento.";
  if (ctx.oppStage !== "WON" && !isOpenStage(ctx.oppStage)) return "Etapa da oportunidade desconhecida.";
  return null;
}

// ---------------------------------------------------------------------------
// Histórico
// ---------------------------------------------------------------------------

const asRecord = (value: unknown): Record<string, unknown> => (value && typeof value === "object" ? (value as Record<string, unknown>) : {});

/** O custo total que a auditoria guardou no `after`/`before` (soma dos itens do retrato). */
function costOf(snapshot: Record<string, unknown>): number | null {
  const items = snapshot.items;
  if (!Array.isArray(items)) return null;
  return items.reduce((sum: number, item) => {
    const row = asRecord(item);
    return sum + (typeof row.quantity === "number" && typeof row.unitCostCents === "number" ? row.quantity * row.unitCostCents : 0);
  }, 0);
}

/**
 * Uma linha do histórico do orçamento, em palavras, a partir do que o servidor gravou na auditoria
 * (o retrato dos itens antes e depois). Ação desconhecida sai como veio — nunca some.
 */
export function describeBudgetHistory(action: string, before: unknown, after: unknown): string {
  const b = asRecord(before);
  const a = asRecord(after);
  const newCost = costOf(a);

  switch (action) {
    case "BUDGET_CREATED":
      return newCost === null ? "Orçamento criado." : `Orçamento criado (custo previsto de ${formatBRL(newCost)}).`;
    case "BUDGET_UPDATED": {
      const oldCost = costOf(b);
      const changed: string[] = [];
      if (JSON.stringify(b.items ?? null) !== JSON.stringify(a.items ?? null)) {
        changed.push(oldCost !== null && newCost !== null && oldCost !== newCost ? `itens (custo de ${formatBRL(oldCost)} para ${formatBRL(newCost)})` : "itens");
      }
      if (JSON.stringify(b.notes ?? null) !== JSON.stringify(a.notes ?? null)) changed.push("observações");
      return changed.length > 0 ? `Orçamento editado: ${changed.join(", ")}.` : "Orçamento editado.";
    }
    default:
      return action;
  }
}
