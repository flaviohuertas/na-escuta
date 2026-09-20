import { AppLink } from "@/components/ui/AppLink";
import { BudgetForm } from "@/components/crm/BudgetForm";
import { crmErrorView } from "@/components/crm/CrmParts";
import { requireSession } from "@/lib/auth/require-session";
import { getBudgetSummary } from "@/server/crm/budget.service";

/** Montar ou editar o orçamento interno. Ao vivo; sem cache do Service Worker. */
export default async function EditBudgetPage({ params }: { params: Promise<{ opportunityId: string }> }) {
  const session = await requireSession();
  const { opportunityId } = await params;

  let view: Awaited<ReturnType<typeof getBudgetSummary>>;
  try {
    view = await getBudgetSummary({ userId: session.user.id, companyId: session.user.companyId, opportunityId });
  } catch (err) {
    return crmErrorView(err);
  }
  const { opportunity, client, budget, revenue, blockedReason } = view;
  const back = `/comercial/oportunidades/${opportunity.id}/orcamento`;

  return (
    <div className="mx-auto max-w-3xl">
      <AppLink href={back} className="text-sm text-slate-600 hover:text-slate-900">
        ← Orçamento interno
      </AppLink>
      <h1 className="mt-2 text-2xl font-semibold text-slate-900">{budget ? "Editar orçamento" : "Montar orçamento"}</h1>
      <p className="mt-1 text-sm text-slate-600">
        {opportunity.title} · {client.name}
      </p>

      {blockedReason ? (
        <p role="status" className="mt-4 rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-700">
          {blockedReason}
        </p>
      ) : (
        <BudgetForm
          opportunityId={opportunity.id}
          version={budget?.version ?? 0}
          initial={
            budget
              ? {
                  items: budget.items.map((item) => ({
                    category: item.category,
                    description: item.description,
                    quantity: item.quantity,
                    unitCostCents: item.unitCostCents,
                    supplier: item.supplier,
                  })),
                  notes: budget.notes,
                }
              : undefined
          }
          revenue={revenue ? { cents: revenue.cents, label: revenue.label } : null}
          cancelHref={back}
        />
      )}
    </div>
  );
}
