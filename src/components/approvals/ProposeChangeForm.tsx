"use client";

import { useState, type FormEvent } from "react";
import { callApi } from "@/components/admin/api";
import { AppLink } from "@/components/ui/AppLink";
import { isoToLocalInput, localInputToIso } from "@/lib/domain/datetime-local";
import { EVENT_STATUS_LABEL } from "@/lib/domain/event-labels";
import { EventStatusValues, type EventStatus } from "@/lib/domain/event.schema";
import { ProposeEventChangeSchema } from "@/lib/domain/approval.schema";
import { navigateToDocument } from "@/lib/offline/navigate";

export interface ProposeFormInitial {
  id: string;
  name: string;
  description: string | null;
  location: string | null;
  startDate: string;
  endDate: string;
  status: EventStatus;
}

const inputClass =
  "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200";

/**
 * A equipe de campo propõe uma correção nos dados do evento. Nada muda no evento agora: o gestor
 * decide. Só os campos que a pessoa REALMENTE alterou vão na proposta — o resto fica como está.
 * Exige conexão (é uma ação de gestão, não de campo) e diz isso em vez de fingir que enviou.
 */
export function ProposeChangeForm({ initial }: { initial: ProposeFormInitial }) {
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description ?? "");
  const [location, setLocation] = useState(initial.location ?? "");
  const [start, setStart] = useState(isoToLocalInput(initial.startDate));
  const [end, setEnd] = useState(isoToLocalInput(initial.endDate));
  const [status, setStatus] = useState<EventStatus>(initial.status);
  const [reason, setReason] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<string, string>>>({});

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});

    // Só o que mudou: comparar com o que a pessoa via ao abrir (as datas, no formato do campo).
    const changes: Record<string, unknown> = {};
    if (name.trim() !== initial.name) changes.name = name;
    if (status !== initial.status) changes.status = status;
    if ((location.trim() || null) !== initial.location) changes.location = location.trim() ? location : null;
    if ((description.trim() || null) !== initial.description) changes.description = description.trim() ? description : null;
    if (start !== isoToLocalInput(initial.startDate)) changes.startDate = localInputToIso(start) ?? "";
    if (end !== isoToLocalInput(initial.endDate)) changes.endDate = localInputToIso(end) ?? "";

    if (Object.keys(changes).length === 0) {
      setError("Altere pelo menos um campo antes de enviar.");
      return;
    }

    // As duas datas do formulário, mesmo que só uma tenha mudado: o término não pode ficar antes do início.
    const startIso = localInputToIso(start);
    const endIso = localInputToIso(end);
    if (startIso && endIso && new Date(endIso) < new Date(startIso)) {
      setFieldErrors({ endDate: "A data de término não pode ser anterior à data de início" });
      return;
    }

    const checked = ProposeEventChangeSchema.safeParse({ eventId: initial.id, changes, reason: reason.trim() ? reason : null });
    if (!checked.success) {
      const problems: Partial<Record<string, string>> = {};
      for (const issue of checked.error.issues) {
        const field = String(issue.path[issue.path[0] === "changes" ? 1 : 0] ?? "changes");
        problems[field] ??= issue.message;
      }
      setFieldErrors(problems);
      if (problems.changes) setError(problems.changes);
      return;
    }

    setSubmitting(true);
    const result = await callApi("POST", "/api/aprovacoes", checked.data);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    // Navegação de documento: a lista de "minhas propostas" é lida do servidor.
    navigateToDocument("/aprovacoes");
  }

  const fieldError = (field: string) => fieldErrors[field];

  return (
    <form onSubmit={onSubmit} noValidate className="mt-6 space-y-4" aria-label="Proposta de alteração do evento">
      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <Field id="propose-name" label="Nome do evento" error={fieldError("name")}>
        <input id="propose-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} className={inputClass} />
      </Field>

      <Field id="propose-location" label="Local" error={fieldError("location")}>
        <input id="propose-location" value={location} onChange={(e) => setLocation(e.target.value)} maxLength={300} className={inputClass} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="propose-start" label="Início" error={fieldError("startDate")}>
          <input id="propose-start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} className={inputClass} />
        </Field>
        <Field id="propose-end" label="Término" error={fieldError("endDate")}>
          <input id="propose-end" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} className={inputClass} />
        </Field>
      </div>

      <Field id="propose-status" label="Situação" error={fieldError("status")}>
        <select id="propose-status" value={status} onChange={(e) => setStatus(e.target.value as EventStatus)} className={inputClass}>
          {EventStatusValues.map((value) => (
            <option key={value} value={value}>
              {EVENT_STATUS_LABEL[value]}
            </option>
          ))}
        </select>
      </Field>

      <Field id="propose-description" label="Descrição" error={fieldError("description")}>
        <textarea id="propose-description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={4000} rows={4} className={inputClass} />
      </Field>

      <Field id="propose-reason" label="Por que corrigir? (opcional, ajuda quem decide)" error={fieldError("reason")}>
        <textarea id="propose-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} rows={2} className={inputClass} />
      </Field>

      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-400 disabled:opacity-60"
        >
          {submitting ? "Enviando…" : "Enviar proposta"}
        </button>
        <AppLink href="/eventos" className="text-sm text-slate-600 hover:text-slate-900">
          Cancelar
        </AppLink>
      </div>
    </form>
  );
}

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">
        {label}
      </label>
      {children}
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-1 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
