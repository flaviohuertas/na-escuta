import { BudgetForm } from "@/components/crm/BudgetForm";
import { crmErrorView } from "@/components/crm/CrmParts";
import { requireSession } from "@/lib/auth/require-session";
import { getBudgetSummary } from "@/server/crm/budget.service";
import { listSupplierOptions } from "@/server/suppliers/supplier.service";
import { PageHeader } from "@/components/ui/PageHeader";

/** Montar ou editar o orçamento interno. Ao vivo; sem cache do Service Worker. */
export default async function EditBudgetPage({ params }: { params: Promise<{ opportunityId: string }> }) {
  const session = await requireSession();
  const { opportunityId } = await params;

  let view: Awaited<ReturnType<typeof getBudgetSummary>>;
  let suppliers: Awaited<ReturnType<typeof listSupplierOptions>>;
  try {
    const ctx = { userId: session.user.id, companyId: session.user.companyId };
    view = await getBudgetSummary({ ...ctx, opportunityId });
    // Os fornecedores para escolher: os ativos e os que o orçamento já cita (mesmo arquivados, para não perder o vínculo ao editar).
    const linked = (view.budget?.items ?? []).map((item) => item.supplierId).filter((id): id is string => id !== null);
    suppliers = await listSupplierOptions({ ...ctx, alsoIds: linked });
  } catch (err) {
    return crmErrorView(err);
  }
  const { opportunity, client, budget, revenue, blockedReason } = view;
  const back = `/comercial/oportunidades/${opportunity.id}/orcamento`;

  return (
    <div className="max-w-3xl">
      <PageHeader
        back={{ href: back, label: "Orçamento interno" }}
        title={budget ? "Editar orçamento" : "Montar orçamento"}
        description={`${opportunity.title} · ${client.name}`}
      />

      {blockedReason ? (
        <p role="status" className="mt-4 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">
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
                    supplierId: item.supplierId,
                  })),
                  notes: budget.notes,
                }
              : undefined
          }
          revenue={revenue ? { cents: revenue.cents, label: revenue.label } : null}
          suppliers={suppliers}
          cancelHref={back}
        />
      )}
    </div>
  );
}
