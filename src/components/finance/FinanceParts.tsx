import { notFound } from "next/navigation";
import { VoidExpenseButton } from "@/components/finance/VoidExpenseButton";
import { AppLink } from "@/components/ui/AppLink";
import { categoryLabel, formatBps, type Margin, type RevenueReference } from "@/lib/domain/budget";
import { formatBRL } from "@/lib/domain/crm";
import { COMPARISON_STATUS_LABEL, formatExpenseDate, type BudgetComparison, type ComparisonStatus } from "@/lib/domain/finance";
import { dateOnlyFromDate } from "@/lib/domain/proposal";
import { formatDateTimeBR } from "@/lib/domain/approval-format";
import { AdminActionError } from "@/server/errors";

/** Quem não é do financeiro (ou não tem empresa) vê isto, não uma página de erro. */
export function FinanceForbidden({ message }: { message: string }) {
  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-2xl font-semibold text-slate-900">Financeiro</h1>
      <div className="mt-4 rounded-md bg-slate-100 px-4 py-3 text-sm text-slate-700">
        <p>{message}</p>
        <AppLink href="/eventos" className="mt-3 inline-block font-medium text-brand-700 hover:underline">
          Voltar aos eventos
        </AppLink>
      </div>
    </div>
  );
}

/** "Não existe" (404 — inclusive o que é de outra empresa) vira a página de não encontrado; sem permissão, o aviso. Qualquer outro erro é bug: relança. */
export function financeErrorView(err: unknown): React.ReactElement {
  if (err instanceof AdminActionError) {
    if (err.status === 404) notFound();
    return <FinanceForbidden message={err.message} />;
  }
  throw err;
}

const STATUS_STYLE: Record<ComparisonStatus, string> = {
  OVER: "bg-red-100 text-red-900",
  WITHIN: "bg-emerald-100 text-emerald-900",
  UNPLANNED: "bg-amber-100 text-amber-900",
};

export function ComparisonBadge({ status }: { status: ComparisonStatus }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[status]}`}>{COMPARISON_STATUS_LABEL[status]}</span>;
}

const signed = (cents: number) => (cents > 0 ? `+${formatBRL(cents)}` : formatBRL(cents));

function MarginText({ margin }: { margin: Margin }) {
  const loss = margin.marginCents < 0;
  return (
    <span className={loss ? "text-red-700" : "text-emerald-800"}>
      {formatBRL(margin.marginCents)}
      {margin.marginBps !== null && <span className="ml-1 text-xs font-medium">({formatBps(margin.marginBps)})</span>}
    </span>
  );
}

/**
 * O resumo do evento: receita (dizendo de onde veio), custo previsto, custo lançado e as duas
 * margens. A margem "até agora" é parcial enquanto o evento ainda gasta — a tela diz isso.
 */
export function FinanceSummary({
  comparison,
  revenue,
  plannedMargin,
  realizedMargin,
}: {
  comparison: BudgetComparison;
  revenue: RevenueReference | null;
  plannedMargin: Margin | null;
  realizedMargin: Margin | null;
}) {
  return (
    <dl className="grid gap-x-6 gap-y-4 rounded-lg border border-slate-200 bg-white p-4 text-sm sm:grid-cols-2 lg:grid-cols-5" data-testid="finance-summary">
      <div>
        <dt className="text-xs uppercase tracking-wide text-slate-500">Receita de referência</dt>
        <dd className="text-base font-semibold tabular-nums text-slate-900" data-testid="finance-revenue">
          {revenue ? formatBRL(revenue.cents) : "—"}
        </dd>
        <dd className="text-xs text-slate-500" data-testid="finance-revenue-source">
          {revenue ? revenue.label : "Evento sem oportunidade de origem."}
        </dd>
      </div>
      <div>
        <dt className="text-xs uppercase tracking-wide text-slate-500">Custo previsto</dt>
        <dd className="text-base font-semibold tabular-nums text-slate-900" data-testid="finance-planned">
          {comparison.hasBudget ? formatBRL(comparison.plannedTotalCents) : "—"}
        </dd>
        {!comparison.hasBudget && <dd className="text-xs text-slate-500">Sem orçamento.</dd>}
      </div>
      <div>
        <dt className="text-xs uppercase tracking-wide text-slate-500">Custo lançado</dt>
        <dd className="text-base font-semibold tabular-nums text-slate-900" data-testid="finance-realized">
          {formatBRL(comparison.realizedTotalCents)}
        </dd>
        {comparison.hasBudget && comparison.consumedTotalBps !== null && (
          <dd className="text-xs text-slate-500" data-testid="finance-consumed">
            {formatBps(comparison.consumedTotalBps)} do previsto
          </dd>
        )}
      </div>
      <div>
        <dt className="text-xs uppercase tracking-wide text-slate-500">Margem prevista</dt>
        <dd className="text-base font-semibold tabular-nums" data-testid="finance-planned-margin">
          {plannedMargin ? <MarginText margin={plannedMargin} /> : <span className="text-sm font-normal text-slate-500">—</span>}
        </dd>
      </div>
      <div>
        <dt className="text-xs uppercase tracking-wide text-slate-500">Margem até agora</dt>
        <dd className="text-base font-semibold tabular-nums" data-testid="finance-realized-margin">
          {realizedMargin ? <MarginText margin={realizedMargin} /> : <span className="text-sm font-normal text-slate-500">—</span>}
        </dd>
        {realizedMargin && realizedMargin.marginCents < 0 && (
          <dd role="status" className="text-xs font-medium text-red-700" data-testid="finance-loss">
            Prejuízo: o custo lançado passa da receita.
          </dd>
        )}
        {realizedMargin && <dd className="text-xs text-slate-500">Parcial: só o custo já lançado.</dd>}
      </div>
    </dl>
  );
}

/** Previsto × realizado por categoria, com o que estourou, o que coube e o que foi gasto sem previsão. */
export function ComparisonTable({ comparison }: { comparison: BudgetComparison }) {
  if (comparison.rows.length === 0) return <p className="mt-2 text-sm text-slate-500">Nada previsto nem lançado ainda.</p>;

  return (
    <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-left text-sm" data-testid="comparison-table">
        <caption className="sr-only">Previsto e realizado por categoria</caption>
        <thead>
          <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
            <th scope="col" className="px-4 py-2 font-medium">
              Categoria
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Previsto
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Lançado
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Diferença
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Situação
            </th>
          </tr>
        </thead>
        <tbody>
          {comparison.rows.map((row) => (
            <tr key={row.category} className="border-b border-slate-50" data-testid={`comparison-${row.category}`}>
              <th scope="row" className="px-4 py-2 text-left font-medium text-slate-900">
                {categoryLabel(row.category)}
              </th>
              <td className="px-3 py-2 text-right tabular-nums" data-testid={`planned-${row.category}`}>
                {row.hasPlan ? formatBRL(row.plannedCents) : "—"}
              </td>
              <td className="px-3 py-2 text-right tabular-nums" data-testid={`realized-${row.category}`}>
                {formatBRL(row.realizedCents)}
                {row.consumedBps !== null && <span className="ml-1 text-xs text-slate-500">({formatBps(row.consumedBps)})</span>}
              </td>
              <td className={`px-3 py-2 text-right tabular-nums ${row.status === "OVER" ? "font-medium text-red-700" : "text-slate-700"}`} data-testid={`variance-${row.category}`}>
                {row.hasPlan ? signed(row.varianceCents) : "—"}
              </td>
              <td className="px-4 py-2">
                <ComparisonBadge status={row.status} />
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-semibold text-slate-900">
            <th scope="row" className="px-4 py-2 text-left">
              Total
            </th>
            <td className="px-3 py-2 text-right tabular-nums">{comparison.hasBudget ? formatBRL(comparison.plannedTotalCents) : "—"}</td>
            <td className="px-3 py-2 text-right tabular-nums" data-testid="comparison-realized-total">
              {formatBRL(comparison.realizedTotalCents)}
            </td>
            <td className={`px-3 py-2 text-right tabular-nums ${comparison.varianceTotalCents > 0 && comparison.hasBudget ? "text-red-700" : ""}`}>
              {comparison.hasBudget ? signed(comparison.varianceTotalCents) : "—"}
            </td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export interface ExpenseRow {
  id: string;
  category: string;
  description: string;
  supplier: string | null;
  amountCents: number;
  expenseDate: Date;
  notes: string | null;
  version: number;
  voidedAt: Date | null;
  voidReason: string | null;
}

/** Os lançamentos, do dia mais novo ao mais antigo. Os estornados continuam aqui, riscados, com o motivo. */
export function ExpenseList({ eventId, expenses }: { eventId: string; expenses: ExpenseRow[] }) {
  if (expenses.length === 0) return <p className="mt-2 text-sm text-slate-500">Nenhum custo lançado ainda.</p>;

  return (
    <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white" data-testid="expense-list">
      {expenses.map((expense) => {
        const voided = expense.voidedAt !== null;
        return (
          <li key={expense.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 text-sm" data-testid="expense-row" data-voided={voided ? "true" : "false"}>
            <div className="min-w-0 flex-1">
              <p className={`font-medium ${voided ? "text-slate-400 line-through" : "text-slate-900"}`}>{expense.description}</p>
              <p className="mt-0.5 text-xs text-slate-500">
                {formatExpenseDate(dateOnlyFromDate(expense.expenseDate))} · {categoryLabel(expense.category)}
                {expense.supplier ? ` · ${expense.supplier}` : ""}
              </p>
              {expense.notes && <p className="mt-0.5 text-xs text-slate-500">{expense.notes}</p>}
              {voided && expense.voidedAt && (
                <p className="mt-1 text-xs font-medium text-red-700" data-testid="void-note">
                  Estornado em {formatDateTimeBR(expense.voidedAt.toISOString())} — {expense.voidReason}
                </p>
              )}
            </div>
            <div className="flex flex-col items-end gap-2">
              <span className={`tabular-nums font-medium ${voided ? "text-slate-400 line-through" : "text-slate-900"}`} data-testid="expense-amount">
                {formatBRL(expense.amountCents)}
              </span>
              {!voided && (
                <span className="flex items-center gap-2">
                  <AppLink href={`/financeiro/eventos/${eventId}/lancamentos/${expense.id}/editar`} className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50" aria-label={`Editar ${expense.description}`}>
                    Editar
                  </AppLink>
                  <VoidExpenseButton expenseId={expense.id} version={expense.version} description={expense.description} />
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
