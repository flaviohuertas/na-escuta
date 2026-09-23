import { AppLink } from "@/components/ui/AppLink";
import { crmErrorView } from "@/components/crm/CrmParts";
import { ProposalForm } from "@/components/crm/ProposalForm";
import { requireSession } from "@/lib/auth/require-session";
import { prepareNewProposal } from "@/server/crm/proposal.service";
import { PageHeader } from "@/components/ui/PageHeader";

/**
 * Nova proposta (um rascunho) para a oportunidade — em branco ou partindo de uma versão anterior
 * (`?copiar=<id>`, só da mesma oportunidade). Ao vivo; sem cache do Service Worker.
 */
export default async function NewProposalPage({
  params,
  searchParams,
}: {
  params: Promise<{ opportunityId: string }>;
  searchParams: Promise<{ copiar?: string }>;
}) {
  const session = await requireSession();
  const { opportunityId } = await params;
  const { copiar } = await searchParams;

  let prepared: Awaited<ReturnType<typeof prepareNewProposal>>;
  try {
    prepared = await prepareNewProposal({
      userId: session.user.id,
      companyId: session.user.companyId,
      opportunityId,
      copyFromProposalId: copiar ?? null,
    });
  } catch (err) {
    return crmErrorView(err);
  }
  const { opportunity, client, existingDraft, blockedReason, copiedFrom, initial } = prepared;
  const back = `/comercial/oportunidades/${opportunity.id}`;

  return (
    <div className="max-w-3xl">
      <PageHeader
        back={{ href: back, label: opportunity.title }}
        title="Nova proposta"
        description={
          <>
            Para {client.name}
            {copiedFrom && <span> · partindo da versão {copiedFrom.number}</span>}
          </>
        }
      />

      {blockedReason ? (
        <p role="status" className="mt-4 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">
          {blockedReason}
        </p>
      ) : existingDraft ? (
        <p role="status" className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Já existe um rascunho (v{existingDraft.number}) desta oportunidade.{" "}
          <AppLink href={`/comercial/propostas/${existingDraft.id}`} className="font-medium underline">
            Continue por ele
          </AppLink>{" "}
          ou descarte-o antes de criar outro.
        </p>
      ) : (
        <ProposalForm
          mode="create"
          opportunityId={opportunity.id}
          copiedFromProposalId={copiedFrom?.id ?? null}
          initial={initial ? { ...initial, validUntil: null } : undefined}
          cancelHref={back}
        />
      )}
    </div>
  );
}
