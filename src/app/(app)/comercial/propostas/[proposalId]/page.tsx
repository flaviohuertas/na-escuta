import { AppLink } from "@/components/ui/AppLink";
import { crmErrorView } from "@/components/crm/CrmParts";
import { PrintButton } from "@/components/crm/PrintButton";
import { ProposalActions } from "@/components/crm/ProposalActions";
import { ProposalDocument, ProposalStatusBadge } from "@/components/crm/ProposalParts";
import { requireSession } from "@/lib/auth/require-session";
import { formatDateTimeBR } from "@/lib/domain/approval-format";
import { PROPOSAL_STATUS_LABEL, formatDateOnlyBR } from "@/lib/domain/proposal";
import { getProposal } from "@/server/crm/proposal.service";
import { buttonClass } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { NoValue } from "@/components/ui/Stat";

/**
 * Uma proposta: o documento (que se imprime), as ações de situação, as outras versões e o
 * histórico. Ao vivo (exige conexão) e sem cache do Service Worker.
 */
export default async function ProposalPage({ params }: { params: Promise<{ proposalId: string }> }) {
  const session = await requireSession();
  const { proposalId } = await params;

  let detail: Awaited<ReturnType<typeof getProposal>>;
  try {
    detail = await getProposal({ userId: session.user.id, companyId: session.user.companyId, proposalId });
  } catch (err) {
    return crmErrorView(err);
  }
  const { proposal, opportunity, client, companyName, versions, draftId, context, createBlockedReason, validUntil, expired, history } = detail;
  const canCreateNewVersion = proposal.status !== "DRAFT" && draftId === null && createBlockedReason === null;
  const otherVersions = versions.filter((v) => v.id !== proposal.id);

  return (
    <div className="max-w-3xl">
      <div className="print:hidden">
        <PageHeader
          back={{ href: `/comercial/oportunidades/${opportunity.id}`, label: opportunity.title }}
          title={`Proposta v${proposal.number}`}
          description={client.name}
          actions={
            <>
              <ProposalStatusBadge status={proposal.status} expired={expired} />
              <PrintButton />
            </>
          }
        />

        {expired && (
          <p role="status" className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            A validade venceu em {formatDateOnlyBR(validUntil)}. Não dá mais para registrar o aceite: crie uma nova versão com uma nova validade.
          </p>
        )}
        {proposal.status === "ACCEPTED" && proposal.decidedAt && (
          <p role="status" className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            Aceita pelo cliente em {formatDateTimeBR(proposal.decidedAt.toISOString())}.{proposal.decisionNote ? ` ${proposal.decisionNote}` : ""}
          </p>
        )}
        {proposal.status === "REJECTED" && proposal.decidedAt && (
          <p role="status" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-900">
            Recusada pelo cliente em {formatDateTimeBR(proposal.decidedAt.toISOString())}.{proposal.decisionNote ? ` ${proposal.decisionNote}` : ""}
          </p>
        )}
        {proposal.status === "SUPERSEDED" && (
          <p role="status" className="mt-3 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">
            Esta versão foi substituída por uma mais nova e ficou só para consulta.
          </p>
        )}
        {opportunity.eventId && (
          <p role="status" className="mt-3 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">
            A oportunidade já virou um evento: as propostas ficam só para consulta.
          </p>
        )}

        <ProposalActions proposalId={proposal.id} opportunityId={opportunity.id} version={proposal.version} context={context} />

        <div className="mt-3 flex flex-wrap gap-2">
          {canCreateNewVersion && (
            <AppLink href={`/comercial/oportunidades/${opportunity.id}/propostas/nova?copiar=${proposal.id}`} className={buttonClass({ variant: "secondary", size: "sm" })}>
              Criar nova versão a partir desta
            </AppLink>
          )}
          {draftId && draftId !== proposal.id && (
            <AppLink href={`/comercial/propostas/${draftId}`} className={buttonClass({ variant: "secondary", size: "sm" })}>
              Continuar o rascunho
            </AppLink>
          )}
        </div>
      </div>

      <div className="mt-4">
        <ProposalDocument
          data={{
            companyName,
            opportunityTitle: opportunity.title,
            client,
            proposal: {
              number: proposal.number,
              status: proposal.status,
              notes: proposal.notes,
              discountCents: proposal.discountCents,
              sentAt: proposal.sentAt,
              items: proposal.items,
            },
            validUntil,
          }}
        />
      </div>

      <div className="print:hidden">
        {otherVersions.length > 0 && (
          <section aria-labelledby="versions" className="mt-8">
            <h2 id="versions" className="text-lg font-semibold text-slate-900">
              Outras versões
            </h2>
            <ul className="mt-2 flex flex-wrap gap-2 text-sm">
              {otherVersions.map((version) => (
                <li key={version.id}>
                  <AppLink
                    href={`/comercial/propostas/${version.id}`}
                    className="inline-flex min-h-11 items-center rounded-xl border border-line bg-white px-3 transition-colors hover:border-brand-300 sm:min-h-9"
                  >
                    v{version.number} · {PROPOSAL_STATUS_LABEL[version.status]}
                  </AppLink>
                </li>
              ))}
            </ul>
          </section>
        )}

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
      </div>
    </div>
  );
}
