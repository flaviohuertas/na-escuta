import { AppLink } from "@/components/ui/AppLink";
import { crmErrorView } from "@/components/crm/CrmParts";
import { PrintButton } from "@/components/crm/PrintButton";
import { ProposalActions } from "@/components/crm/ProposalActions";
import { ProposalDocument, ProposalStatusBadge } from "@/components/crm/ProposalParts";
import { requireSession } from "@/lib/auth/require-session";
import { formatDateTimeBR } from "@/lib/domain/approval-format";
import { PROPOSAL_STATUS_LABEL, formatDateOnlyBR } from "@/lib/domain/proposal";
import { getProposal } from "@/server/crm/proposal.service";

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
    <div className="mx-auto max-w-3xl">
      <div className="print:hidden">
        <AppLink href={`/comercial/oportunidades/${opportunity.id}`} className="text-sm text-slate-600 hover:text-slate-900">
          ← {opportunity.title}
        </AppLink>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Proposta v{proposal.number}</h1>
            <p className="mt-1 text-sm text-slate-600">{client.name}</p>
          </div>
          <div className="flex items-center gap-3">
            <ProposalStatusBadge status={proposal.status} expired={expired} />
            <PrintButton />
          </div>
        </div>

        {expired && (
          <p role="status" className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
            A validade venceu em {formatDateOnlyBR(validUntil)}. Não dá mais para registrar o aceite: crie uma nova versão com uma nova validade.
          </p>
        )}
        {proposal.status === "ACCEPTED" && proposal.decidedAt && (
          <p role="status" className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            Aceita pelo cliente em {formatDateTimeBR(proposal.decidedAt.toISOString())}.{proposal.decisionNote ? ` ${proposal.decisionNote}` : ""}
          </p>
        )}
        {proposal.status === "REJECTED" && proposal.decidedAt && (
          <p role="status" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-900">
            Recusada pelo cliente em {formatDateTimeBR(proposal.decidedAt.toISOString())}.{proposal.decisionNote ? ` ${proposal.decisionNote}` : ""}
          </p>
        )}
        {proposal.status === "SUPERSEDED" && (
          <p role="status" className="mt-3 rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-700">
            Esta versão foi substituída por uma mais nova e ficou só para consulta.
          </p>
        )}
        {opportunity.eventId && (
          <p role="status" className="mt-3 rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-700">
            A oportunidade já virou um evento: as propostas ficam só para consulta.
          </p>
        )}

        <ProposalActions proposalId={proposal.id} opportunityId={opportunity.id} version={proposal.version} context={context} />

        <div className="mt-3 flex flex-wrap gap-4 text-sm">
          {canCreateNewVersion && (
            <AppLink href={`/comercial/oportunidades/${opportunity.id}/propostas/nova?copiar=${proposal.id}`} className="font-medium text-brand-700 hover:underline">
              Criar nova versão a partir desta
            </AppLink>
          )}
          {draftId && draftId !== proposal.id && (
            <AppLink href={`/comercial/propostas/${draftId}`} className="font-medium text-brand-700 hover:underline">
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
                  <AppLink href={`/comercial/propostas/${version.id}`} className="rounded-md border border-slate-200 bg-white px-3 py-1.5 hover:border-brand-300">
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
      </div>
    </div>
  );
}
