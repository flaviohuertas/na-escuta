import { AppLink } from "@/components/ui/AppLink";
import { ProposalChanges } from "@/components/approvals/ProposalChanges";
import { formatDateTimeBR } from "@/lib/domain/approval-format";
import type { ProposalStatus, ProposalView } from "@/lib/domain/approval";

export const PROPOSAL_STATUS_LABEL: Record<ProposalStatus, string> = {
  PENDING: "Aguardando decisão",
  APPROVED: "Aprovada",
  REJECTED: "Rejeitada",
};

const STATUS_STYLE: Record<ProposalStatus, string> = {
  PENDING: "bg-amber-100 text-amber-900",
  APPROVED: "bg-emerald-100 text-emerald-900",
  REJECTED: "bg-red-100 text-red-900",
};

export function ProposalStatusBadge({ status }: { status: ProposalStatus }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[status]}`}>{PROPOSAL_STATUS_LABEL[status]}</span>;
}

/**
 * As propostas que a pessoa fez, com a situação de cada uma — e, se rejeitada, o motivo que o
 * gestor deu. Só leitura (sem estado): serve à tela do servidor.
 */
export function MyProposals({ proposals }: { proposals: ProposalView[] }) {
  if (proposals.length === 0) {
    return <p className="mt-2 text-sm text-slate-500">Você ainda não propôs nenhuma alteração.</p>;
  }
  return (
    <ul className="mt-2 space-y-3">
      {proposals.map((proposal) => (
        <li key={proposal.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm" data-testid="my-proposal">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <AppLink href={`/eventos/${proposal.eventId}`} className="font-medium text-slate-900 hover:underline">
              {proposal.eventName}
            </AppLink>
            <ProposalStatusBadge status={proposal.status} />
          </div>
          <p className="mt-1 text-xs text-slate-500">Proposta em {formatDateTimeBR(proposal.submittedAt)}</p>
          {proposal.reason && <p className="mt-2 text-sm text-slate-700">Motivo: {proposal.reason}</p>}
          <ProposalChanges changes={proposal.changes} showConflicts={false} />
          {proposal.status !== "PENDING" && (
            <p className="mt-2 text-sm text-slate-700">
              {proposal.status === "APPROVED" ? "Aprovada" : "Rejeitada"} por {proposal.reviewedByName ?? "o gestor"}
              {proposal.reviewedAt ? ` em ${formatDateTimeBR(proposal.reviewedAt)}` : ""}.
              {proposal.reviewNotes ? ` ${proposal.status === "REJECTED" ? "Motivo" : "Observação"}: ${proposal.reviewNotes}` : ""}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
