"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { callApi } from "@/components/admin/api";
import { ProposalChanges } from "@/components/approvals/ProposalChanges";
import { ProposalStatusBadge } from "@/components/approvals/MyProposals";
import { AppLink } from "@/components/ui/AppLink";
import { formatDateTimeBR } from "@/lib/domain/approval-format";
import { fieldLabel, type ProposalView } from "@/lib/domain/approval";
import { ReviewDecisionSchema } from "@/lib/domain/approval.schema";

/**
 * As propostas que esperam a decisão do gestor. A tela só mostra e envia a decisão: o servidor
 * revalida tudo (quem é gestor do evento, "não decide a própria", o evento não mudou desde a
 * proposta). Se ele recusar, a mensagem aparece no cartão da proposta como veio.
 */
export function ApprovalInbox({ pending, decided }: { pending: ProposalView[]; decided: ProposalView[] }) {
  const router = useRouter();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);

  async function decide(proposal: ProposalView, decision: "APPROVE" | "REJECT") {
    setNotice(null);
    setErrors((current) => ({ ...current, [proposal.id]: "" }));

    // Mesma regra do servidor (rejeitar exige o motivo), antes de gastar uma ida à rede.
    const checked = ReviewDecisionSchema.safeParse({ decision, notes: notes[proposal.id] ?? "" });
    if (!checked.success) {
      setErrors((current) => ({ ...current, [proposal.id]: checked.error.issues[0]?.message ?? "Confira a decisão." }));
      return;
    }

    setBusy(proposal.id);
    const result = await callApi("POST", `/api/aprovacoes/${proposal.id}/decisao`, checked.data);
    setBusy(null);
    if (!result.ok) {
      setErrors((current) => ({ ...current, [proposal.id]: result.message }));
      return;
    }
    setNotice(
      decision === "APPROVE"
        ? "Proposta aprovada e aplicada ao evento. Os aparelhos que já o prepararam recebem a alteração no próximo sincronismo."
        : "Proposta rejeitada. Quem propôs vê o motivo que você deu."
    );
    router.refresh();
  }

  return (
    <div>
      {notice && (
        <p role="status" className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {notice}
        </p>
      )}

      {pending.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">Nenhuma proposta esperando decisão.</p>
      ) : (
        <ul className="mt-2 space-y-4">
          {pending.map((proposal) => {
            const blocked = proposal.unreadable || proposal.conflictFields.length > 0;
            const error = errors[proposal.id];
            return (
              <li key={proposal.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm" data-testid="pending-proposal">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <AppLink href={`/eventos/${proposal.eventId}`} className="font-medium text-slate-900 hover:underline">
                    {proposal.eventName}
                  </AppLink>
                  <ProposalStatusBadge status={proposal.status} />
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Proposta de <strong>{proposal.submittedBy.name}</strong> em {formatDateTimeBR(proposal.submittedAt)}
                </p>
                {proposal.reason && <p className="mt-2 text-sm text-slate-700">Motivo: {proposal.reason}</p>}

                {proposal.unreadable ? (
                  <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
                    Esta proposta está corrompida e não pode ser aplicada. Só dá para rejeitá-la.
                  </p>
                ) : (
                  <ProposalChanges changes={proposal.changes} showConflicts />
                )}

                {proposal.conflictFields.length > 0 && (
                  <div role="alert" className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    <p>
                      O evento mudou depois desta proposta ({proposal.conflictFields.map(fieldLabel).join(", ")}). Não dá para
                      aprovar por cima: rejeite e peça uma nova, ou{" "}
                      <AppLink href={`/eventos/${proposal.eventId}/editar`} className="font-medium underline">
                        edite o evento direto
                      </AppLink>
                      .
                    </p>
                  </div>
                )}

                <div className="mt-3">
                  <label htmlFor={`notes-${proposal.id}`} className="block text-sm font-medium text-slate-700">
                    Observação <span className="font-normal text-slate-500">(obrigatória para rejeitar)</span>
                  </label>
                  <textarea
                    id={`notes-${proposal.id}`}
                    value={notes[proposal.id] ?? ""}
                    onChange={(e) => setNotes((current) => ({ ...current, [proposal.id]: e.target.value }))}
                    maxLength={1000}
                    rows={2}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
                  />
                </div>

                {error && (
                  <p role="alert" className="mt-2 text-sm font-medium text-red-700" data-testid="proposal-error">
                    {error}
                  </p>
                )}

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void decide(proposal, "APPROVE")}
                    disabled={blocked || busy !== null}
                    aria-label={`Aprovar a proposta de ${proposal.submittedBy.name} para ${proposal.eventName}`}
                    className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busy === proposal.id ? "Enviando…" : "Aprovar"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void decide(proposal, "REJECT")}
                    disabled={busy !== null}
                    aria-label={`Rejeitar a proposta de ${proposal.submittedBy.name} para ${proposal.eventName}`}
                    className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Rejeitar
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {decided.length > 0 && (
        <div className="mt-6">
          <h3 className="text-sm font-medium text-slate-700">Decididas recentemente</h3>
          <ul className="mt-2 space-y-2">
            {decided.map((proposal) => (
              <li key={proposal.id} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm" data-testid="decided-proposal">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-slate-800">{proposal.eventName}</span>
                  <ProposalStatusBadge status={proposal.status} />
                </div>
                <p className="mt-1 text-xs text-slate-600">
                  Proposta de {proposal.submittedBy.name} · {proposal.status === "APPROVED" ? "aprovada" : "rejeitada"} por{" "}
                  {proposal.reviewedByName ?? "—"}
                  {proposal.reviewedAt ? ` em ${formatDateTimeBR(proposal.reviewedAt)}` : ""}
                  {proposal.reviewNotes ? ` · ${proposal.reviewNotes}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
