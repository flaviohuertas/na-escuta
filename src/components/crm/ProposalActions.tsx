"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { callApi } from "@/components/admin/api";
import { AppLink } from "@/components/ui/AppLink";
import { explainBlockedProposalAction, type ProposalContext } from "@/lib/domain/proposal";
import { ProposalActionSchema } from "@/lib/domain/proposal.schema";
import { navigateToDocument } from "@/lib/offline/navigate";

type Pending = "SEND" | "ACCEPT" | "REJECT" | "DISCARD";

const PANEL: Record<Pending, { text: string; confirm: string; danger?: boolean; noteLabel?: string }> = {
  SEND: {
    text: "Isto só REGISTRA que você enviou a proposta ao cliente — o sistema não envia e-mail nem mensagem. Depois de enviada ela não pode mais ser editada: para mudar, crie uma nova versão.",
    confirm: "Confirmar envio",
  },
  ACCEPT: {
    text: "Registra que o cliente aceitou. A oportunidade passa para Ganho (o evento é criado num passo seguinte, se você quiser).",
    confirm: "Confirmar aceite",
    noteLabel: "Observação (opcional)",
  },
  REJECT: {
    text: "Registra que o cliente recusou. A oportunidade continua onde está — você decide o próximo passo.",
    confirm: "Confirmar recusa",
    danger: true,
    noteLabel: "Motivo da recusa (opcional)",
  },
  DISCARD: {
    text: "O rascunho e os itens dele serão apagados. Isto não pode ser desfeito.",
    confirm: "Confirmar descarte",
    danger: true,
  },
};

/**
 * Os botões de situação da proposta — só os que o servidor permite agora (`explainBlockedProposalAction`,
 * a mesma regra dele). Cada ação pede confirmação. Se outra pessoa mexeu primeiro, o servidor
 * responde 409 e a tela oferece recarregar em vez de sobrescrever.
 */
export function ProposalActions({
  proposalId,
  opportunityId,
  version,
  context,
}: {
  proposalId: string;
  opportunityId: string;
  version: number;
  context: ProposalContext;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<Pending | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outdated, setOutdated] = useState(false);

  const blocked = (action: Pending | "EDIT") => explainBlockedProposalAction(action, context);
  const isDraft = context.status === "DRAFT";
  const isSent = context.status === "SENT";
  if (!isDraft && !isSent) return null;

  // O que a pessoa espera fazer agora mas o servidor não deixa (envio sem validade, aceite vencido…).
  const primary: Pending = isDraft ? "SEND" : "ACCEPT";
  const primaryBlocked = blocked(primary);

  function open(action: Pending) {
    setError(null);
    setOutdated(false);
    setNote("");
    setPending((current) => (current === action ? null : action));
  }

  async function confirm(action: Pending) {
    setError(null);
    setOutdated(false);
    const checked = ProposalActionSchema.safeParse({
      action,
      baseVersion: version,
      note: action === "ACCEPT" || action === "REJECT" ? note : null,
    });
    if (!checked.success) {
      setError(checked.error.issues[0]?.message ?? "Confira os dados.");
      return;
    }

    setBusy(true);
    const result = await callApi("POST", `/api/comercial/propostas/${proposalId}/situacao`, checked.data);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      setOutdated(result.status === 409);
      return;
    }
    if (action === "DISCARD") {
      navigateToDocument(`/comercial/oportunidades/${opportunityId}`);
      return;
    }
    setPending(null);
    setNote("");
    router.refresh();
  }

  const buttons: Array<{ action: Pending; label: string; tone: "primary" | "plain" | "danger" }> = isDraft
    ? [
        { action: "SEND", label: "Marcar como enviada", tone: "primary" },
        { action: "DISCARD", label: "Descartar rascunho", tone: "danger" },
      ]
    : [
        { action: "ACCEPT", label: "Cliente aceitou", tone: "primary" },
        { action: "REJECT", label: "Cliente recusou", tone: "danger" },
      ];

  const toneClass = {
    primary: "border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-100",
    plain: "border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
    danger: "border-red-300 bg-red-50 text-red-900 hover:bg-red-100",
  } as const;

  return (
    <div className="mt-4" data-testid="proposal-actions">
      <div className="flex flex-wrap items-center gap-2">
        {isDraft && blocked("EDIT") === null && (
          <AppLink href={`/comercial/propostas/${proposalId}/editar`} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Editar rascunho
          </AppLink>
        )}
        {buttons
          .filter(({ action }) => blocked(action) === null)
          .map(({ action, label, tone }) => (
            <button
              key={action}
              type="button"
              onClick={() => open(action)}
              disabled={busy}
              aria-expanded={pending === action}
              className={`rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-60 ${toneClass[tone]}`}
            >
              {label}
            </button>
          ))}
      </div>

      {primaryBlocked && (
        <p role="note" className="mt-2 text-sm text-amber-900">
          {primaryBlocked}
        </p>
      )}

      {pending && (
        <div className="mt-3 rounded-md bg-slate-50 p-3" data-testid="proposal-confirm">
          <p className="text-sm text-slate-700">{PANEL[pending].text}</p>
          {PANEL[pending].noteLabel && (
            <div className="mt-2">
              <label htmlFor="proposal-note" className="block text-sm font-medium text-slate-700">
                {PANEL[pending].noteLabel}
              </label>
              <textarea
                id="proposal-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={500}
                rows={2}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
              />
            </div>
          )}
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void confirm(pending)}
              disabled={busy}
              className={`rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60 ${PANEL[pending].danger ? "bg-red-700 hover:bg-red-800" : "bg-brand-600 hover:bg-brand-700"}`}
            >
              {busy ? "Salvando…" : PANEL[pending].confirm}
            </button>
            <button type="button" onClick={() => setPending(null)} disabled={busy} className="text-sm text-slate-600 hover:text-slate-900">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {error && (
        <div role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          <p>{error}</p>
          {outdated && (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-2 rounded-md border border-red-300 bg-white px-3 py-1 text-sm font-medium text-red-700 hover:bg-red-100"
            >
              Carregar a proposta atual
            </button>
          )}
        </div>
      )}
    </div>
  );
}
