import { AppLink } from "@/components/ui/AppLink";
import { BudgetTable, MarginSummary } from "@/components/crm/BudgetParts";
import { crmErrorView } from "@/components/crm/CrmParts";
import { requireSession } from "@/lib/auth/require-session";
import { formatDateTimeBR } from "@/lib/domain/approval-format";
import { getBudget } from "@/server/crm/budget.service";

/**
 * O orçamento interno da oportunidade: custo por categoria, receita de referência e margem. É
 * confidencial da produtora (nunca aparece na proposta). Ao vivo (exige conexão) e sem cache do
 * Service Worker.
 */
export default async function BudgetPage({ params }: { params: Promise<{ opportunityId: string }> }) {
  const session = await requireSession();
  const { opportunityId } = await params;

  let view: Awaited<ReturnType<typeof getBudget>>;
  try {
    view = await getBudget({ userId: session.user.id, companyId: session.user.companyId, opportunityId });
  } catch (err) {
    return crmErrorView(err);
  }
  const { opportunity, client, budget, totals, revenue, margin, blockedReason, history } = view;
  const editHref = `/comercial/oportunidades/${opportunity.id}/orcamento/editar`;

  return (
    <div className="mx-auto max-w-3xl">
      <AppLink href={`/comercial/oportunidades/${opportunity.id}`} className="text-sm text-slate-600 hover:text-slate-900">
        ← {opportunity.title}
      </AppLink>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Orçamento interno</h1>
          <p className="mt-1 text-sm text-slate-600">
            {opportunity.title} · {client.name}
          </p>
        </div>
        {!blockedReason && (
          <AppLink href={editHref} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
            {budget ? "Editar orçamento" : "Montar orçamento"}
          </AppLink>
        )}
      </div>
      <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">Confidencial da produtora: o custo e a margem não aparecem na proposta ao cliente.</p>
      {blockedReason && (
        <p role="status" className="mt-3 rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-700">
          {blockedReason}
        </p>
      )}

      <div className="mt-4">
        <MarginSummary totalCostCents={totals.totalCents} revenue={revenue} margin={margin} hasBudget={budget !== null} />
      </div>

      {budget ? (
        <div className="mt-6">
          <BudgetTable items={budget.items} totals={totals} />
          {budget.notes && (
            <section aria-label="Premissas e observações" className="mt-4 rounded-lg border border-slate-200 bg-white p-4 text-sm">
              <p className="text-xs uppercase tracking-wide text-slate-500">Premissas e observações</p>
              <p className="mt-1 whitespace-pre-line text-slate-800">{budget.notes}</p>
            </section>
          )}
        </div>
      ) : (
        <p className="mt-6 text-sm text-slate-500">Ainda não há orçamento para esta oportunidade.</p>
      )}

      {history.length > 0 && (
        <section aria-labelledby="history" className="mt-8">
          <h2 id="history" className="text-lg font-semibold text-slate-900">
            Histórico
          </h2>
          <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white text-sm">
            {history.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2" data-testid="history-entry">
                <span className="text-slate-800">{entry.text}</span>
                <span className="text-xs text-slate-500">
                  {entry.actorName ?? "—"} · {formatDateTimeBR(entry.at.toISOString())}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
