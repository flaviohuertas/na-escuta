"use client";

import { useMemo, useState, type FormEvent } from "react";
import { callApi } from "@/components/admin/api";
import { Field, inputClass } from "@/components/crm/Field";
import { buttonClass } from "@/components/ui/Button";
import { AppLink } from "@/components/ui/AppLink";
import { centsToInput, formatBRL, parseBRLToCents } from "@/lib/domain/crm";
import { MAX_ITEMS, MAX_ITEM_DESCRIPTION, MAX_NOTES, MAX_QUANTITY, computeTotals } from "@/lib/domain/proposal";
import { ProposalInputSchema, ProposalUpdateSchema } from "@/lib/domain/proposal.schema";
import { navigateToDocument } from "@/lib/offline/navigate";

export interface ProposalFormInitial {
  items: Array<{ description: string; quantity: number; unitPriceCents: number }>;
  discountCents: number;
  /** "2027-01-10" */
  validUntil: string | null;
  notes: string | null;
}

interface Row {
  key: number;
  description: string;
  quantity: string;
  price: string;
}

/** A chave de cada linha do formulário (só para o React separar as linhas; não vai para o servidor). */
let rowKeyCounter = 0;
const newRow = (values: Partial<Omit<Row, "key">> = {}): Row => ({ key: rowKeyCounter++, description: "", quantity: "1", price: "", ...values });

/** A quantidade digitada: só número inteiro (nada de "2,5" — proposta vende unidades). */
const parseQuantity = (text: string): number | null => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : null);

/**
 * Criar/editar o rascunho de uma proposta. Preços e desconto são digitados em reais ("1.500,00") e
 * vão ao servidor em CENTAVOS inteiros; os totais mostrados aqui saem da MESMA conta do servidor
 * (`computeTotals`), que é quem grava — o cliente nunca manda um total.
 */
export function ProposalForm({
  mode,
  opportunityId,
  proposalId,
  version,
  initial,
  copiedFromProposalId = null,
  cancelHref,
}: {
  mode: "create" | "edit";
  opportunityId: string;
  proposalId?: string;
  version?: number;
  initial?: ProposalFormInitial;
  /** De qual versão este rascunho partiu (só registra no histórico). */
  copiedFromProposalId?: string | null;
  cancelHref: string;
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    initial && initial.items.length > 0
      ? initial.items.map((item) =>
          newRow({ description: item.description, quantity: String(item.quantity), price: centsToInput(item.unitPriceCents) })
        )
      : [newRow()]
  );
  const [discount, setDiscount] = useState(initial && initial.discountCents > 0 ? centsToInput(initial.discountCents) : "");
  const [validUntil, setValidUntil] = useState(initial?.validUntil ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outdated, setOutdated] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<string, string>>>({});
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});

  function updateRow(key: number, patch: Partial<Omit<Row, "key">>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  // Os totais ao vivo: o que ainda não é um valor válido conta como zero (e o envio recusa).
  const live = useMemo(() => {
    const lines = rows.map((row) => ({ quantity: parseQuantity(row.quantity) ?? 0, unitPriceCents: parseBRLToCents(row.price) ?? 0 }));
    const discountCents = discount.trim() ? (parseBRLToCents(discount) ?? 0) : 0;
    return computeTotals(lines, discountCents);
  }, [rows, discount]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setOutdated(false);
    setFieldErrors({});
    setRowErrors({});

    const problems: Record<number, string> = {};
    const items = rows.map((row, index) => {
      const quantity = parseQuantity(row.quantity);
      const unitPriceCents = row.price.trim() ? parseBRLToCents(row.price) : null;
      if (quantity === null) problems[index] = "Informe a quantidade como um número inteiro.";
      else if (unitPriceCents === null) problems[index] = row.price.trim() ? "Informe o preço como 1.500,00 (vírgula nos centavos)." : "Informe o preço do item.";
      return { description: row.description, quantity: quantity ?? 0, unitPriceCents: unitPriceCents ?? 0 };
    });
    const discountCents = discount.trim() ? parseBRLToCents(discount) : 0;
    if (Object.keys(problems).length > 0 || discountCents === null) {
      setRowErrors(problems);
      if (discountCents === null) setFieldErrors({ discountCents: "Informe o desconto como 500,00 (vírgula nos centavos)." });
      return;
    }

    const payload = {
      items,
      discountCents,
      validUntil: validUntil || null,
      notes: notes.trim() ? notes : null,
      ...(mode === "edit" ? { baseVersion: version } : { copiedFromProposalId }),
    };
    const checked = (mode === "edit" ? ProposalUpdateSchema : ProposalInputSchema).safeParse(payload);
    if (!checked.success) {
      const byRow: Record<number, string> = {};
      const byField: Partial<Record<string, string>> = {};
      for (const issue of checked.error.issues) {
        if (issue.path[0] === "items" && typeof issue.path[1] === "number") byRow[issue.path[1]] ??= issue.message;
        else byField[String(issue.path[0] ?? "")] ??= issue.message;
      }
      setRowErrors(byRow);
      setFieldErrors(byField);
      return;
    }

    setSubmitting(true);
    const result = await callApi<{ proposal: { id: string } }>(
      mode === "edit" ? "PATCH" : "POST",
      mode === "edit" ? `/api/comercial/propostas/${proposalId}` : `/api/comercial/oportunidades/${opportunityId}/propostas`,
      payload
    );
    setSubmitting(false);
    if (!result.ok) {
      setError(result.message);
      setOutdated(mode === "edit" && result.status === 409);
      return;
    }
    navigateToDocument(`/comercial/propostas/${result.data.proposal.id}`);
  }

  return (
    <form onSubmit={onSubmit} noValidate className="mt-6 space-y-5" aria-label="Dados da proposta">
      {error && (
        <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          <p>{error}</p>
          {outdated && (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-2 rounded-md border border-red-300 bg-white px-3 py-1 text-sm font-medium text-red-700 hover:bg-red-100"
            >
              Carregar os dados atuais
            </button>
          )}
        </div>
      )}

      <fieldset>
        <legend className="text-sm font-semibold text-slate-800">Itens</legend>
        <ul className="mt-2 space-y-3">
          {rows.map((row, index) => {
            const n = index + 1;
            const lineTotal = live.lineTotals[index] ?? 0;
            return (
              <li key={row.key} className="rounded-md border border-slate-200 bg-white p-3" data-testid="proposal-form-row">
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_6rem_9rem]">
                  <label className="block">
                    <span aria-hidden="true" className="text-xs text-slate-500">
                      Descrição
                    </span>
                    <input
                      aria-label={`Descrição do item ${n}`}
                      value={row.description}
                      onChange={(e) => updateRow(row.key, { description: e.target.value })}
                      maxLength={MAX_ITEM_DESCRIPTION}
                      className={inputClass}
                    />
                  </label>
                  <label className="block">
                    <span aria-hidden="true" className="text-xs text-slate-500">
                      Qtd.
                    </span>
                    <input
                      aria-label={`Quantidade do item ${n}`}
                      value={row.quantity}
                      onChange={(e) => updateRow(row.key, { quantity: e.target.value })}
                      inputMode="numeric"
                      maxLength={String(MAX_QUANTITY).length}
                      className={inputClass}
                    />
                  </label>
                  <label className="block">
                    <span aria-hidden="true" className="text-xs text-slate-500">
                      Preço unitário (R$)
                    </span>
                    <input
                      aria-label={`Preço unitário do item ${n}`}
                      value={row.price}
                      onChange={(e) => updateRow(row.key, { price: e.target.value })}
                      inputMode="decimal"
                      placeholder="1.500,00"
                      className={inputClass}
                    />
                  </label>
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                  <p className="text-slate-600">
                    Total do item: <span className="font-medium tabular-nums text-slate-900" data-testid={`line-total-${n}`}>{formatBRL(lineTotal)}</span>
                  </p>
                  <button
                    type="button"
                    onClick={() => setRows((current) => current.filter((r) => r.key !== row.key))}
                    disabled={rows.length === 1}
                    aria-label={`Remover item ${n}`}
                    className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                  >
                    Remover
                  </button>
                </div>
                {rowErrors[index] && (
                  <p role="alert" className="mt-1 text-sm text-red-700">
                    Item {n}: {rowErrors[index]}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
        {fieldErrors.items && (
          <p role="alert" className="mt-2 text-sm text-red-700">
            {fieldErrors.items}
          </p>
        )}
        <button
          type="button"
          onClick={() => setRows((current) => [...current, newRow()])}
          disabled={rows.length >= MAX_ITEMS}
          className="mt-3 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"
        >
          Adicionar item
        </button>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="proposal-discount" label="Desconto (R$, opcional)" error={fieldErrors.discountCents} hint="Ex.: 500,00">
          <input id="proposal-discount" value={discount} onChange={(e) => setDiscount(e.target.value)} inputMode="decimal" className={inputClass} />
        </Field>
        <Field
          id="proposal-valid-until"
          label="Válida até"
          error={fieldErrors.validUntil}
          hint="O último dia em que a proposta vale. Obrigatória para marcar como enviada."
        >
          <input id="proposal-valid-until" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className={inputClass} />
        </Field>
      </div>

      <Field id="proposal-notes" label="Condições e observações (opcional)" error={fieldErrors.notes} hint="Forma de pagamento, prazos, o que está incluso…">
        <textarea id="proposal-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={MAX_NOTES} rows={4} className={inputClass} />
      </Field>

      <dl className="ml-auto w-full max-w-xs space-y-1 rounded-md bg-slate-50 p-3 text-sm" aria-label="Totais">
        <div className="flex justify-between">
          <dt className="text-slate-600">Subtotal</dt>
          <dd className="tabular-nums" data-testid="form-subtotal">
            {formatBRL(live.subtotalCents)}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-slate-600">Desconto</dt>
          <dd className="tabular-nums" data-testid="form-discount">
            − {formatBRL(live.discountCents)}
          </dd>
        </div>
        <div className="flex justify-between border-t border-slate-300 pt-1 font-semibold text-slate-900">
          <dt>Total</dt>
          <dd className="tabular-nums" data-testid="form-total">
            {formatBRL(live.totalCents)}
          </dd>
        </div>
      </dl>

      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={submitting}
          className={buttonClass()}
        >
          {submitting ? "Salvando…" : mode === "edit" ? "Salvar rascunho" : "Criar rascunho"}
        </button>
        <AppLink href={cancelHref} className={buttonClass({ variant: "ghost" })}>
          Cancelar
        </AppLink>
      </div>
    </form>
  );
}
