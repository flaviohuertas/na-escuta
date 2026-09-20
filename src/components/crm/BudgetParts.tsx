import { categoryLabel, formatBps, type BudgetTotals, type Margin, type RevenueReference } from "@/lib/domain/budget";
import { formatBRL } from "@/lib/domain/crm";

/**
 * Custo previsto, receita de referência e margem. A tela SEMPRE diz de onde veio a receita (uma
 * proposta aceita, uma enviada, um rascunho ou só o valor estimado): estimativa não passa por preço
 * fechado. Margem negativa aparece como prejuízo — nunca escondida nem arredondada para zero.
 */
export function MarginSummary({
  totalCostCents,
  revenue,
  margin,
  hasBudget,
}: {
  totalCostCents: number;
  revenue: RevenueReference | null;
  margin: Margin | null;
  hasBudget: boolean;
}) {
  const loss = margin !== null && margin.marginCents < 0;

  return (
    <dl className="grid gap-x-6 gap-y-3 rounded-lg border border-slate-200 bg-white p-4 text-sm sm:grid-cols-3" data-testid="margin-summary">
      <div>
        <dt className="text-xs uppercase tracking-wide text-slate-500">Custo previsto</dt>
        <dd className="text-base font-semibold tabular-nums text-slate-900" data-testid="budget-cost">
          {hasBudget ? formatBRL(totalCostCents) : "—"}
        </dd>
      </div>
      <div>
        <dt className="text-xs uppercase tracking-wide text-slate-500">Receita de referência</dt>
        <dd className="text-base font-semibold tabular-nums text-slate-900" data-testid="budget-revenue">
          {revenue ? formatBRL(revenue.cents) : "—"}
        </dd>
        <dd className="text-xs text-slate-500" data-testid="budget-revenue-source">
          {revenue ? revenue.label : "Sem proposta nem valor estimado."}
        </dd>
      </div>
      <div>
        <dt className="text-xs uppercase tracking-wide text-slate-500">Margem</dt>
        {margin ? (
          <>
            <dd className={`text-base font-semibold tabular-nums ${loss ? "text-red-700" : "text-emerald-800"}`} data-testid="budget-margin">
              {formatBRL(margin.marginCents)}
              {margin.marginBps !== null && <span className="ml-1.5 text-sm font-medium">({formatBps(margin.marginBps)})</span>}
            </dd>
            {loss && (
              <dd role="status" className="text-xs font-medium text-red-700" data-testid="budget-loss">
                Prejuízo: o custo passa da receita.
              </dd>
            )}
            {margin.marginBps === null && <dd className="text-xs text-slate-500">Sem percentual: a receita é zero.</dd>}
          </>
        ) : (
          <dd className="text-xs text-slate-500" data-testid="budget-margin">
            {!hasBudget ? "Monte o orçamento para ver a margem." : "Defina o valor estimado da oportunidade ou crie uma proposta."}
          </dd>
        )}
      </div>
    </dl>
  );
}

export interface BudgetTableItem {
  id: string;
  category: string;
  description: string;
  quantity: number;
  unitCostCents: number;
  supplier: string | null;
}

/** Os itens agrupados por categoria (na ordem do orçamento), com o subtotal de cada uma e o total. */
export function BudgetTable({ items, totals }: { items: BudgetTableItem[]; totals: BudgetTotals }) {
  const lineTotalOf = new Map(items.map((item, index) => [item.id, totals.lineTotals[index] ?? 0]));

  return (
    <div className="space-y-4">
      {totals.byCategory.map((group) => (
        <section key={group.category} aria-label={categoryLabel(group.category)} data-testid={`category-${group.category}`} className="rounded-lg border border-slate-200 bg-white">
          <header className="flex items-baseline justify-between gap-2 border-b border-slate-100 px-4 py-2">
            <h3 className="text-sm font-semibold text-slate-800">{categoryLabel(group.category)}</h3>
            <span className="text-sm font-medium tabular-nums text-slate-900" data-testid={`subtotal-${group.category}`}>
              {formatBRL(group.subtotalCents)}
            </span>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Itens de {categoryLabel(group.category)}</caption>
              <thead>
                <tr className="text-xs uppercase tracking-wide text-slate-500">
                  <th scope="col" className="px-4 py-1.5 font-medium">
                    Item
                  </th>
                  <th scope="col" className="px-3 py-1.5 text-right font-medium">
                    Qtd.
                  </th>
                  <th scope="col" className="px-3 py-1.5 text-right font-medium">
                    Custo unit.
                  </th>
                  <th scope="col" className="px-4 py-1.5 text-right font-medium">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {items
                  .filter((item) => item.category === group.category)
                  .map((item) => (
                    <tr key={item.id} className="border-t border-slate-50" data-testid="budget-item">
                      <td className="px-4 py-1.5 text-slate-900">
                        {item.description}
                        {item.supplier && <span className="block text-xs text-slate-500">{item.supplier}</span>}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{item.quantity}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{formatBRL(item.unitCostCents)}</td>
                      <td className="px-4 py-1.5 text-right tabular-nums">{formatBRL(lineTotalOf.get(item.id) ?? 0)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      <p className="flex justify-between rounded-lg bg-slate-50 px-4 py-2 text-base font-semibold text-slate-900">
        <span>Custo total previsto</span>
        <span className="tabular-nums" data-testid="budget-total">
          {formatBRL(totals.totalCents)}
        </span>
      </p>
    </div>
  );
}
