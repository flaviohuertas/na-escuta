import { AppLink } from "@/components/ui/AppLink";
import { ComparisonTable, ExpenseList, FinanceSummary, financeErrorView } from "@/components/finance/FinanceParts";
import { ExpenseForm } from "@/components/finance/ExpenseForm";
import { requireSession } from "@/lib/auth/require-session";
import { formatDateTimeBR } from "@/lib/domain/approval-format";
import { formatDateBR } from "@/lib/domain/crm";
import { EVENT_STATUS_LABEL } from "@/lib/domain/event-labels";
import type { EventStatus } from "@/lib/domain/event.schema";
import { getEventFinance } from "@/server/finance/finance.service";
import { listSupplierOptions } from "@/server/suppliers/supplier.service";
import { PageHeader } from "@/components/ui/PageHeader";
import { NoValue } from "@/components/ui/Stat";

/**
 * O financeiro de um evento: o resumo (receita, previsto, lançado, margens), a comparação por
 * categoria com o orçamento, os lançamentos (com estorno) e o histórico. Só titular e
 * administração. Ao vivo (exige conexão) e fora do cache do Service Worker.
 */
export default async function EventFinancePage({ params }: { params: Promise<{ eventId: string }> }) {
  const session = await requireSession();
  const { eventId } = await params;

  let view: Awaited<ReturnType<typeof getEventFinance>>;
  let suppliers: Awaited<ReturnType<typeof listSupplierOptions>>;
  try {
    const ctx = { userId: session.user.id, companyId: session.user.companyId };
    view = await getEventFinance({ ...ctx, eventId });
    suppliers = await listSupplierOptions(ctx);
  } catch (err) {
    return financeErrorView(err);
  }
  const { event, opportunity, expenses, truncated, comparison, revenue, plannedMargin, realizedMargin, history, today } = view;

  return (
    <div className="max-w-4xl">
      <PageHeader
        back={{ href: "/financeiro", label: "Financeiro" }}
        title={event.name}
        description={
          <>
            {EVENT_STATUS_LABEL[event.status as EventStatus] ?? event.status} · {formatDateBR(event.startDate)} a {formatDateBR(event.endDate)}
            {opportunity && (
              <>
                {" · "}
                <AppLink href={`/comercial/oportunidades/${opportunity.id}`} className="font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800">
                  Oportunidade de origem
                </AppLink>
              </>
            )}
          </>
        }
      />
      <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
        Confidencial da produtora: só titular e administração veem esta tela. Estes lançamentos nunca vão para o aparelho de campo.
      </p>

      <div className="mt-4">
        <FinanceSummary comparison={comparison} revenue={revenue} plannedMargin={plannedMargin} realizedMargin={realizedMargin} />
      </div>

      <section aria-labelledby="comparison" className="mt-8">
        <h2 id="comparison" className="text-lg font-semibold text-slate-900">
          Previsto × lançado
        </h2>
        {!comparison.hasBudget && (
          <p className="mt-1 text-sm text-slate-500">
            {opportunity ? "A oportunidade de origem não tem orçamento: só há o custo lançado." : "Este evento não nasceu de uma oportunidade: não há orçamento previsto."}
          </p>
        )}
        <ComparisonTable comparison={comparison} />
      </section>

      <section aria-labelledby="expenses" className="mt-8">
        <h2 id="expenses" className="text-lg font-semibold text-slate-900">
          Lançamentos
        </h2>
        {/* Sempre visível: quem lança custo lança vários em sequência, e o aviso "Lançamento salvo." tem de aparecer. */}
        <div className="mt-2 rounded-xl border border-line bg-white p-4" data-testid="new-expense">
          <h3 className="text-sm font-semibold text-slate-800">Novo lançamento</h3>
          <ExpenseForm mode="create" eventId={event.id} defaultDate={today} suppliers={suppliers} />
        </div>
        <ExpenseList eventId={event.id} expenses={expenses} />
        {truncated && (
          <p role="status" className="mt-2 text-sm text-amber-800">
            Mostrando os 500 lançamentos mais recentes. Os totais somam todos.
          </p>
        )}
      </section>

      {history.length > 0 && (
        <section aria-labelledby="history" className="mt-8">
          <h2 id="history" className="text-lg font-semibold text-slate-900">
            Histórico
          </h2>
          <ul className="mt-2 divide-y divide-slate-100 rounded-xl border border-line bg-white text-sm">
            {history.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2" data-testid="history-entry">
                <span className="text-slate-800">{entry.text}</span>
                <span className="text-xs text-slate-500">
                  {entry.actorName ?? <NoValue label="sem autor" />} · {formatDateTimeBR(entry.at.toISOString())}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
