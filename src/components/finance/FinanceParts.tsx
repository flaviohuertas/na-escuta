import { notFound } from "next/navigation";
import { VoidExpenseButton } from "@/components/finance/VoidExpenseButton";
import { AppLink } from "@/components/ui/AppLink";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { buttonClass } from "@/components/ui/Button";
import { cardClass } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { NoValue, Stat, type StatTone } from "@/components/ui/Stat";
import { categoryLabel, formatBps, type Margin, type RevenueReference } from "@/lib/domain/budget";
import { formatBRL } from "@/lib/domain/crm";
import { COMPARISON_STATUS_LABEL, formatExpenseDate, type BudgetComparison, type ComparisonStatus } from "@/lib/domain/finance";
import { dateOnlyFromDate } from "@/lib/domain/proposal";
import { formatDateTimeBR } from "@/lib/domain/approval-format";
import { AdminActionError } from "@/server/errors";

/** Quem não é do financeiro (ou não tem empresa) vê isto, não uma página de erro. */
export function FinanceForbidden({ message }: { message: string }) {
  return (
    <div className="max-w-xl">
      <PageHeader title="Financeiro" description={message} />
      <AppLink href="/eventos" className={buttonClass({ variant: "secondary", className: "mt-6" })}>
        Voltar aos eventos
      </AppLink>
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

const STATUS_TONE: Record<ComparisonStatus, BadgeTone> = {
  OVER: "danger",
  WITHIN: "success",
  UNPLANNED: "warning",
};

export function ComparisonBadge({ status }: { status: ComparisonStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{COMPARISON_STATUS_LABEL[status]}</Badge>;
}

const signed = (cents: number) => (cents > 0 ? `+${formatBRL(cents)}` : formatBRL(cents));

/** O valor da margem e o percentual, que acompanha o número em tamanho menor. */
function MarginValue({ margin }: { margin: Margin }) {
  return (
    <>
      {formatBRL(margin.marginCents)}
      {margin.marginBps !== null && <span className="ml-1.5 font-sans text-sm font-semibold">({formatBps(margin.marginBps)})</span>}
    </>
  );
}

const marginTone = (margin: Margin | null): StatTone => (!margin ? "neutral" : margin.marginCents < 0 ? "danger" : "success");

const NOTE = "mt-0.5 text-xs text-slate-500";

/**
 * O resumo do evento. Em destaque, o que se acompanha durante o evento: a margem até agora e o custo
 * lançado. Embaixo, as referências: receita (dizendo de onde veio), custo previsto e margem prevista.
 * A margem "até agora" é parcial enquanto o evento ainda gasta, e a tela diz isso.
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
    <dl className={cardClass({ className: "grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-6" })} data-testid="finance-summary">
      <Stat
        className="lg:col-span-3"
        size="lg"
        label="Margem até agora"
        tone={marginTone(realizedMargin)}
        valueTestId="finance-realized-margin"
        value={realizedMargin ? <MarginValue margin={realizedMargin} /> : <NoValue label="sem receita de referência" />}
        note={
          <>
            {realizedMargin && realizedMargin.marginCents < 0 && (
              <dd role="status" className="mt-0.5 text-sm font-medium text-red-700" data-testid="finance-loss">
                Prejuízo: o custo lançado passa da receita.
              </dd>
            )}
            {realizedMargin && <dd className={NOTE}>Parcial: só o custo já lançado.</dd>}
          </>
        }
      />
      <Stat
        className="lg:col-span-3"
        size="lg"
        label="Custo lançado"
        valueTestId="finance-realized"
        value={formatBRL(comparison.realizedTotalCents)}
        note={
          comparison.hasBudget &&
          comparison.consumedTotalBps !== null && (
            <dd className={NOTE} data-testid="finance-consumed">
              {formatBps(comparison.consumedTotalBps)} do previsto
            </dd>
          )
        }
      />
      <Stat
        className="border-t border-line pt-4 lg:col-span-2"
        size="sm"
        label="Receita de referência"
        valueTestId="finance-revenue"
        value={revenue ? formatBRL(revenue.cents) : <NoValue label="sem receita" />}
        note={
          <dd className={NOTE} data-testid="finance-revenue-source">
            {revenue ? revenue.label : "Evento sem oportunidade de origem."}
          </dd>
        }
      />
      <Stat
        className="border-t border-line pt-4 lg:col-span-2"
        size="sm"
        label="Custo previsto"
        valueTestId="finance-planned"
        value={comparison.hasBudget ? formatBRL(comparison.plannedTotalCents) : <NoValue label="sem orçamento" />}
        note={!comparison.hasBudget && <dd className={NOTE}>Sem orçamento.</dd>}
      />
      <Stat
        className="border-t border-line pt-4 lg:col-span-2"
        size="sm"
        label="Margem prevista"
        tone={marginTone(plannedMargin)}
        valueTestId="finance-planned-margin"
        value={plannedMargin ? <MarginValue margin={plannedMargin} /> : <NoValue label="sem previsão" />}
      />
    </dl>
  );
}

/** Previsto × realizado por categoria, com o que estourou, o que coube e o que foi gasto sem previsão. */
export function ComparisonTable({ comparison }: { comparison: BudgetComparison }) {
  if (comparison.rows.length === 0) {
    return (
      <div className="mt-2">
        <EmptyState hint="Monte o orçamento da oportunidade ou lance o primeiro custo abaixo.">Nada previsto nem lançado ainda.</EmptyState>
      </div>
    );
  }

  return (
    // `relative`: o texto `sr-only` do `NoValue` é posicionado em absoluto; sem um ancestral posicionado ele
    // escapa da rolagem da tabela e alarga a página inteira no celular.
    <div className="relative mt-2 overflow-x-auto rounded-xl border border-line bg-white" role="region" aria-label="Comparação entre previsto e lançado" tabIndex={0}>
      <table className="w-full text-left text-sm" data-testid="comparison-table">
        <caption className="sr-only">Previsto e realizado por categoria</caption>
        <thead>
          <tr className="border-b border-line text-xs uppercase tracking-wide text-slate-500">
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
            <tr key={row.category} className="border-b border-slate-100" data-testid={`comparison-${row.category}`}>
              <th scope="row" className="px-4 py-2 text-left font-medium text-slate-900">
                {categoryLabel(row.category)}
              </th>
              <td className="px-3 py-2 text-right tabular-nums" data-testid={`planned-${row.category}`}>
                {row.hasPlan ? formatBRL(row.plannedCents) : <NoValue label="sem previsão" />}
              </td>
              <td className="px-3 py-2 text-right tabular-nums" data-testid={`realized-${row.category}`}>
                {formatBRL(row.realizedCents)}
                {row.consumedBps !== null && <span className="ml-1 text-xs text-slate-500">({formatBps(row.consumedBps)})</span>}
              </td>
              <td className={`px-3 py-2 text-right tabular-nums ${row.status === "OVER" ? "font-medium text-red-700" : "text-slate-700"}`} data-testid={`variance-${row.category}`}>
                {row.hasPlan ? signed(row.varianceCents) : <NoValue label="sem previsão" />}
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
            <td className="px-3 py-2 text-right tabular-nums">{comparison.hasBudget ? formatBRL(comparison.plannedTotalCents) : <NoValue label="sem orçamento" />}</td>
            <td className="px-3 py-2 text-right tabular-nums" data-testid="comparison-realized-total">
              {formatBRL(comparison.realizedTotalCents)}
            </td>
            <td className={`px-3 py-2 text-right tabular-nums ${comparison.varianceTotalCents > 0 && comparison.hasBudget ? "text-red-700" : ""}`}>
              {comparison.hasBudget ? signed(comparison.varianceTotalCents) : <NoValue label="sem orçamento" />}
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
  /** O fornecedor do cadastro, se houver: o nome vira link para a ficha dele. */
  supplierId?: string | null;
  amountCents: number;
  expenseDate: Date;
  notes: string | null;
  version: number;
  voidedAt: Date | null;
  voidReason: string | null;
}

/** Os lançamentos, do dia mais novo ao mais antigo. Os estornados continuam aqui, riscados, com o motivo. */
export function ExpenseList({ eventId, expenses }: { eventId: string; expenses: ExpenseRow[] }) {
  if (expenses.length === 0) {
    return (
      <div className="mt-2">
        <EmptyState hint="Cada custo lançado aqui entra no previsto × lançado acima.">Nenhum custo lançado ainda.</EmptyState>
      </div>
    );
  }

  return (
    <ul className="mt-2 divide-y divide-slate-100 rounded-xl border border-line bg-white" data-testid="expense-list">
      {expenses.map((expense) => {
        const voided = expense.voidedAt !== null;
        return (
          <li key={expense.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 text-sm" data-testid="expense-row" data-voided={voided ? "true" : "false"}>
            <div className="min-w-0 flex-1">
              <p className={`font-medium ${voided ? "text-slate-400 line-through" : "text-slate-900"}`}>{expense.description}</p>
              <p className="mt-0.5 text-xs text-slate-500">
                {formatExpenseDate(dateOnlyFromDate(expense.expenseDate))} · {categoryLabel(expense.category)}
                {expense.supplier && (
                  <>
                    {" · "}
                    {expense.supplierId ? (
                      <AppLink href={`/fornecedores/${expense.supplierId}`} className="text-brand-700 underline underline-offset-2 hover:text-brand-800" data-testid="supplier-link">
                        {expense.supplier}
                      </AppLink>
                    ) : (
                      expense.supplier
                    )}
                  </>
                )}
              </p>
              {expense.notes && <p className="mt-0.5 text-xs text-slate-500">{expense.notes}</p>}
              {voided && expense.voidedAt && (
                <p className="mt-1 text-xs font-medium text-red-700" data-testid="void-note">
                  Estornado em {formatDateTimeBR(expense.voidedAt.toISOString())}. Motivo: {expense.voidReason}
                </p>
              )}
            </div>
            <div className="flex flex-col items-end gap-2">
              <span className={`tabular-nums font-medium ${voided ? "text-slate-400 line-through" : "text-slate-900"}`} data-testid="expense-amount">
                {formatBRL(expense.amountCents)}
              </span>
              {!voided && (
                <span className="flex items-center gap-1">
                  <AppLink href={`/financeiro/eventos/${eventId}/lancamentos/${expense.id}/editar`} className={buttonClass({ variant: "ghost", size: "sm" })} aria-label={`Editar ${expense.description}`}>
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
