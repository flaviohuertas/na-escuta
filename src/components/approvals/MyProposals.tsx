import { AppLink } from "@/components/ui/AppLink";
import { ProposalChanges } from "@/components/approvals/ProposalChanges";
import { formatDateTimeBR } from "@/lib/domain/approval-format";
import type { ProposalStatus, ProposalView } from "@/lib/domain/approval";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";

export const PROPOSAL_STATUS_LABEL: Record<ProposalStatus, string> = {
  PENDING: "Aguardando decisão",
  APPROVED: "Aprovada",
  REJECTED: "Rejeitada",
};

// Aguardando decisão é o que está em curso, esperando alguém: a cor da marca (regra do `Badge`).
const STATUS_TONE: Record<ProposalStatus, BadgeTone> = {
  PENDING: "brand",
  APPROVED: "success",
  REJECTED: "danger",
};

export function ProposalStatusBadge({ status }: { status: ProposalStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{PROPOSAL_STATUS_LABEL[status]}</Badge>;
}

/**
 * As propostas que a pessoa fez, com a situação de cada uma — e, se rejeitada, o motivo que o
 * gestor deu. Só leitura (sem estado): serve à tela do servidor.
 */
export function MyProposals({ proposals }: { proposals: ProposalView[] }) {
  if (proposals.length === 0) {
    return (
      <div className="mt-2">
        <EmptyState hint="Para corrigir um dado de evento, use Propor alteração na lista de eventos.">
          Você ainda não propôs nenhuma alteração.
        </EmptyState>
      </div>
    );
  }
  return (
    <ul className="mt-2 space-y-3">
      {proposals.map((proposal) => (
        <li key={proposal.id} className="rounded-xl border border-line bg-white p-4" data-testid="my-proposal">
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
