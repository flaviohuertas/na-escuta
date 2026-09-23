"use client";

import { useRef, useState, type FormEvent } from "react";
import { callApi } from "@/components/admin/api";
import { AppLink } from "@/components/ui/AppLink";
import { Field, RequiredNote, inputClass, issuesByField } from "@/components/crm/Field";
import { buttonClass } from "@/components/ui/Button";
import { useFocusFirstInvalid } from "@/components/ui/use-focus-first-invalid";
import { centsToInput, parseBRLToCents } from "@/lib/domain/crm";
import { OpportunityInputSchema, OpportunityUpdateSchema } from "@/lib/domain/crm.schema";
import { isoToLocalInput, localInputToIso } from "@/lib/domain/datetime-local";
import { navigateToDocument } from "@/lib/offline/navigate";

export interface OpportunityFormInitial {
  id: string;
  clientId: string;
  title: string;
  description: string | null;
  expectedValueCents: number | null;
  expectedStartDate: string | null;
  expectedEndDate: string | null;
  ownerUserId: string | null;
  version: number;
}

/** Só a data ("2027-01-10"), no fuso do aparelho, para o campo de data. */
const toDateInput = (iso: string | null) => (iso ? isoToLocalInput(iso).slice(0, 10) : "");
/** A data digitada como início do dia no fuso do aparelho, em ISO. */
const fromDateInput = (value: string) => (value ? localInputToIso(`${value}T00:00`) : null);

/**
 * Abrir/editar uma oportunidade. O valor é digitado em reais ("15.000,00") e vai ao servidor em
 * CENTAVOS inteiros — dinheiro nunca viaja como número quebrado. O cliente escolhido na abertura
 * não muda depois (para outro cliente, abra outra oportunidade).
 */
export function OpportunityForm({
  mode,
  clients,
  owners,
  currentUserId,
  defaultClientId,
  initial,
}: {
  mode: "create" | "edit";
  clients: Array<{ id: string; name: string }>;
  owners: Array<{ id: string; name: string }>;
  currentUserId: string;
  defaultClientId?: string;
  initial?: OpportunityFormInitial;
}) {
  const [clientId, setClientId] = useState(initial?.clientId ?? defaultClientId ?? "");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [value, setValue] = useState(centsToInput(initial?.expectedValueCents));
  const [start, setStart] = useState(toDateInput(initial?.expectedStartDate ?? null));
  const [end, setEnd] = useState(toDateInput(initial?.expectedEndDate ?? null));
  const [ownerUserId, setOwnerUserId] = useState(initial?.ownerUserId ?? currentUserId);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outdated, setOutdated] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<string, string>>>({});
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstInvalid(formRef, fieldErrors);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setOutdated(false);
    setFieldErrors({});

    const cents = value.trim() ? parseBRLToCents(value) : null;
    if (value.trim() && cents === null) {
      setFieldErrors({ expectedValueCents: "Informe o valor como 15.000,00 (vírgula nos centavos)." });
      return;
    }

    const payload = {
      clientId,
      title,
      description: description.trim() ? description : null,
      expectedValueCents: cents,
      expectedStartDate: fromDateInput(start),
      expectedEndDate: fromDateInput(end),
      ownerUserId,
      ...(mode === "edit" && initial ? { baseVersion: initial.version } : {}),
    };
    const checked = (mode === "edit" ? OpportunityUpdateSchema : OpportunityInputSchema).safeParse(payload);
    if (!checked.success) {
      setFieldErrors(issuesByField(checked.error.issues));
      return;
    }

    setSubmitting(true);
    const result = await callApi<{ opportunity: { id: string } }>(
      mode === "edit" ? "PATCH" : "POST",
      mode === "edit" && initial ? `/api/comercial/oportunidades/${initial.id}` : "/api/comercial/oportunidades",
      payload
    );
    setSubmitting(false);
    if (!result.ok) {
      setError(result.message);
      setOutdated(mode === "edit" && result.status === 409);
      return;
    }
    navigateToDocument(`/comercial/oportunidades/${result.data.opportunity.id}`);
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="mt-6 space-y-4" aria-label="Dados da oportunidade">
      <RequiredNote />
      {error && (
        <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          <p>{error}</p>
          {outdated && (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className={buttonClass({ variant: "secondary", size: "sm", className: "mt-2" })}
            >
              Carregar os dados atuais
            </button>
          )}
        </div>
      )}

      <Field id="opp-client" label="Cliente" error={fieldErrors.clientId} required hint={mode === "edit" ? "O cliente não muda depois de aberta a oportunidade." : undefined}>
        <select id="opp-client" value={clientId} onChange={(e) => setClientId(e.target.value)} disabled={mode === "edit"} className={inputClass}>
          <option value="">Escolha o cliente…</option>
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name}
            </option>
          ))}
        </select>
      </Field>

      <Field id="opp-title" label="Título" error={fieldErrors.title} required>
        <input id="opp-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className={inputClass} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="opp-value" label="Valor estimado (R$, opcional)" error={fieldErrors.expectedValueCents} hint="Ex.: 15.000,00">
          <input id="opp-value" value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" className={inputClass} />
        </Field>
        <Field id="opp-owner" label="Responsável" error={fieldErrors.ownerUserId}>
          <select id="opp-owner" value={ownerUserId} onChange={(e) => setOwnerUserId(e.target.value)} className={inputClass}>
            {owners.map((owner) => (
              <option key={owner.id} value={owner.id}>
                {owner.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="opp-start" label="Início previsto (opcional)" error={fieldErrors.expectedStartDate}>
          <input id="opp-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} className={inputClass} />
        </Field>
        <Field id="opp-end" label="Término previsto (opcional)" error={fieldErrors.expectedEndDate}>
          <input id="opp-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} className={inputClass} />
        </Field>
      </div>

      <Field id="opp-description" label="Descrição (opcional)" error={fieldErrors.description}>
        <textarea id="opp-description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={4000} rows={4} className={inputClass} />
      </Field>

      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={submitting}
          className={buttonClass()}
        >
          {submitting ? "Salvando…" : mode === "edit" ? "Salvar alterações" : "Abrir oportunidade"}
        </button>
        <AppLink href={mode === "edit" && initial ? `/comercial/oportunidades/${initial.id}` : "/comercial"} className={buttonClass({ variant: "ghost" })}>
          Cancelar
        </AppLink>
      </div>
    </form>
  );
}
