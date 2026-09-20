import { AppLink } from "@/components/ui/AppLink";
import { crmErrorView } from "@/components/crm/CrmParts";
import { OpportunityForm } from "@/components/crm/OpportunityForm";
import { requireSession } from "@/lib/auth/require-session";
import { listClientOptions } from "@/server/crm/client.service";
import { getOpportunity, listOwnerOptions } from "@/server/crm/opportunity.service";

/** Editar os dados da oportunidade. Ao vivo; sem cache do Service Worker. */
export default async function EditOpportunityPage({ params }: { params: Promise<{ opportunityId: string }> }) {
  const session = await requireSession();
  const { opportunityId } = await params;
  const ctx = { userId: session.user.id, companyId: session.user.companyId };

  let detail: Awaited<ReturnType<typeof getOpportunity>>;
  let clients: Awaited<ReturnType<typeof listClientOptions>>;
  let owners: Awaited<ReturnType<typeof listOwnerOptions>>;
  try {
    [detail, clients, owners] = await Promise.all([getOpportunity({ ...ctx, opportunityId }), listClientOptions(ctx), listOwnerOptions(ctx)]);
  } catch (err) {
    return crmErrorView(err);
  }
  const { opportunity, client } = detail;
  // O cliente da oportunidade aparece no seletor mesmo que tenha sido arquivado depois.
  const options = clients.some((c) => c.id === client.id) ? clients : [{ id: client.id, name: client.name }, ...clients];

  return (
    <div className="mx-auto max-w-xl">
      <AppLink href={`/comercial/oportunidades/${opportunity.id}`} className="text-sm text-slate-600 hover:text-slate-900">
        ← {opportunity.title}
      </AppLink>
      <h1 className="mt-2 text-2xl font-semibold text-slate-900">Editar oportunidade</h1>
      <OpportunityForm
        mode="edit"
        clients={options}
        owners={owners}
        currentUserId={session.user.id}
        initial={{
          id: opportunity.id,
          clientId: opportunity.clientId,
          title: opportunity.title,
          description: opportunity.description,
          expectedValueCents: opportunity.expectedValueCents,
          expectedStartDate: opportunity.expectedStartDate?.toISOString() ?? null,
          expectedEndDate: opportunity.expectedEndDate?.toISOString() ?? null,
          ownerUserId: opportunity.ownerUserId,
          version: opportunity.version,
        }}
      />
    </div>
  );
}
