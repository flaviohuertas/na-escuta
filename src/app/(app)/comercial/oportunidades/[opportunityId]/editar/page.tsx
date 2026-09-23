import { crmErrorView } from "@/components/crm/CrmParts";
import { OpportunityForm } from "@/components/crm/OpportunityForm";
import { requireSession } from "@/lib/auth/require-session";
import { listClientOptions } from "@/server/crm/client.service";
import { getOpportunity, listOwnerOptions } from "@/server/crm/opportunity.service";
import { PageHeader } from "@/components/ui/PageHeader";

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
    <div className="max-w-xl">
      <PageHeader back={{ href: `/comercial/oportunidades/${opportunity.id}`, label: opportunity.title }} title="Editar oportunidade" />
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
