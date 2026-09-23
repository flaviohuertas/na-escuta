import { crmErrorView } from "@/components/crm/CrmParts";
import { ProposalForm } from "@/components/crm/ProposalForm";
import { requireSession } from "@/lib/auth/require-session";
import { explainBlockedProposalAction } from "@/lib/domain/proposal";
import { getProposal } from "@/server/crm/proposal.service";
import { PageHeader } from "@/components/ui/PageHeader";

/** Editar o rascunho da proposta. Só rascunho: a proposta enviada ganha uma nova versão. Ao vivo; sem cache do Service Worker. */
export default async function EditProposalPage({ params }: { params: Promise<{ proposalId: string }> }) {
  const session = await requireSession();
  const { proposalId } = await params;

  let detail: Awaited<ReturnType<typeof getProposal>>;
  try {
    detail = await getProposal({ userId: session.user.id, companyId: session.user.companyId, proposalId });
  } catch (err) {
    return crmErrorView(err);
  }
  const { proposal, opportunity, client, context, validUntil } = detail;
  const back = `/comercial/propostas/${proposal.id}`;
  const blocked = explainBlockedProposalAction("EDIT", context);

  return (
    <div className="max-w-3xl">
      <PageHeader
        back={{ href: back, label: `Proposta v${proposal.number}` }}
        title={`Editar proposta v${proposal.number}`}
        description={`${opportunity.title} · ${client.name}`}
      />

      {blocked ? (
        <p role="status" className="mt-4 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">
          {blocked}
        </p>
      ) : (
        <ProposalForm
          mode="edit"
          opportunityId={opportunity.id}
          proposalId={proposal.id}
          version={proposal.version}
          initial={{
            items: proposal.items.map((item) => ({ description: item.description, quantity: item.quantity, unitPriceCents: item.unitPriceCents })),
            discountCents: proposal.discountCents,
            validUntil,
            notes: proposal.notes,
          }}
          cancelHref={back}
        />
      )}
    </div>
  );
}
