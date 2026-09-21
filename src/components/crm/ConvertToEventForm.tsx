"use client";

import { useRef, useState, type FormEvent } from "react";
import { callApi } from "@/components/admin/api";
import { Field, RequiredNote, inputClass, issuesByField } from "@/components/crm/Field";
import { buttonClass } from "@/components/ui/Button";
import { useFocusFirstInvalid } from "@/components/ui/use-focus-first-invalid";
import { ConvertToEventSchema } from "@/lib/domain/crm.schema";
import { isoToLocalInput, localInputToIso } from "@/lib/domain/datetime-local";
import { EVENT_STATUS_LABEL } from "@/lib/domain/event-labels";
import { EventStatusValues, type EventStatus } from "@/lib/domain/event.schema";
import { navigateToDocument } from "@/lib/offline/navigate";

export interface ConvertInitial {
  name: string;
  description: string | null;
  /** As datas previstas da oportunidade (ISO), se houver: a pessoa confere e completa a hora. */
  startDate: string | null;
  endDate: string | null;
}

/**
 * Transforma a oportunidade em EVENTO: os dados do evento saem da oportunidade (a pessoa confere e
 * completa as datas) e, ao confirmar, a oportunidade vira "ganha" e passa a apontar para o evento —
 * tudo ou nada, no servidor. A pessoa vira gestora do evento criado.
 */
export function ConvertToEventForm({
  opportunityId,
  version,
  initial,
}: {
  opportunityId: string;
  version: number;
  initial: ConvertInitial;
}) {
  const [name, setName] = useState(initial.name);
  const [location, setLocation] = useState("");
  const [start, setStart] = useState(initial.startDate ? isoToLocalInput(initial.startDate) : "");
  const [end, setEnd] = useState(initial.endDate ? isoToLocalInput(initial.endDate) : "");
  const [status, setStatus] = useState<EventStatus>("PLANNED");
  const [description, setDescription] = useState(initial.description ?? "");

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

    const payload = {
      event: {
        name,
        description: description.trim() ? description : null,
        location: location.trim() ? location : null,
        startDate: localInputToIso(start) ?? "",
        endDate: localInputToIso(end) ?? "",
        status,
      },
      baseVersion: version,
    };
    const checked = ConvertToEventSchema.safeParse(payload);
    if (!checked.success) {
      // Os caminhos vêm como ["event", "name"]: o campo é o segundo nível.
      setFieldErrors(issuesByField(checked.error.issues.map((i) => ({ path: i.path.slice(i.path[0] === "event" ? 1 : 0), message: i.message }))));
      return;
    }

    setSubmitting(true);
    const result = await callApi<{ event: { id: string } }>("POST", `/api/comercial/oportunidades/${opportunityId}/evento`, payload);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.message);
      setOutdated(result.status === 409);
      return;
    }
    navigateToDocument(`/eventos/${result.data.event.id}`);
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="mt-3 space-y-4" aria-label="Criar evento a partir da oportunidade">
      <RequiredNote />
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

      <Field id="conv-name" label="Nome do evento" error={fieldErrors.name} required>
        <input id="conv-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} className={inputClass} />
      </Field>
      <Field id="conv-location" label="Local (opcional)" error={fieldErrors.location}>
        <input id="conv-location" value={location} onChange={(e) => setLocation(e.target.value)} maxLength={300} className={inputClass} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="conv-start" label="Início do evento" error={fieldErrors.startDate} required>
          <input id="conv-start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} className={inputClass} />
        </Field>
        <Field id="conv-end" label="Término do evento" error={fieldErrors.endDate} required>
          <input id="conv-end" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} className={inputClass} />
        </Field>
      </div>
      <Field id="conv-status" label="Situação" error={fieldErrors.status}>
        <select id="conv-status" value={status} onChange={(e) => setStatus(e.target.value as EventStatus)} className={inputClass}>
          {EventStatusValues.map((value) => (
            <option key={value} value={value}>
              {EVENT_STATUS_LABEL[value]}
            </option>
          ))}
        </select>
      </Field>
      <Field id="conv-description" label="Descrição (opcional)" error={fieldErrors.description}>
        <textarea id="conv-description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={4000} rows={3} className={inputClass} />
      </Field>

      <button
        type="submit"
        disabled={submitting}
        className={buttonClass()}
      >
        {submitting ? "Criando…" : "Criar evento e marcar como ganha"}
      </button>
    </form>
  );
}
