"use client";

import { useRef, useState, type FormEvent } from "react";
import { z } from "zod";
import { AppLink } from "@/components/ui/AppLink";
import { Button, buttonClass } from "@/components/ui/Button";
import { Field, RequiredNote, inputClass } from "@/components/ui/Field";
import { useFocusFirstInvalid } from "@/components/ui/use-focus-first-invalid";
import { getDb } from "@/lib/db/dexie/db";
import { isoToLocalInput, localInputToIso } from "@/lib/domain/datetime-local";
import { EVENT_STATUS_LABEL } from "@/lib/domain/event-labels";
import {
  EventInputSchema,
  EventStatusValues,
  EventUpdateInputSchema,
  type EventStatus,
} from "@/lib/domain/event.schema";
import { navigateToDocument } from "@/lib/offline/navigate";
import { eventFromSnapshot } from "@/lib/sync/event-local";
import { EventSnapshotSchema } from "@/lib/sync/protocol";

export interface EventFormInitial {
  id: string;
  name: string;
  description: string | null;
  location: string | null;
  startDate: string;
  endDate: string;
  status: EventStatus;
  version: number;
}

type FieldErrors = Partial<Record<string, string[]>>;

const OFFLINE_MESSAGE =
  "Sem conexão. Criar e editar eventos exige internet. Tente de novo quando estiver conectado. O que você digitou continua aqui.";

/**
 * Criar/editar evento. É uma ação de GESTÃO, feita online: não passa pela outbox. Por isso, sem
 * rede, o formulário diz isso com todas as letras (e mantém o que foi digitado) em vez de
 * fingir que salvou.
 */
export function EventForm({ mode, initial }: { mode: "create" | "edit"; initial?: EventFormInitial }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [location, setLocation] = useState(initial?.location ?? "");
  const [start, setStart] = useState(initial ? isoToLocalInput(initial.startDate) : "");
  const [end, setEnd] = useState(initial ? isoToLocalInput(initial.endDate) : "");
  const [status, setStatus] = useState<EventStatus>(initial?.status ?? "PLANNED");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [outdated, setOutdated] = useState(false);

  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstInvalid(formRef, fieldErrors);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setOutdated(false);

    const startDate = localInputToIso(start);
    const endDate = localInputToIso(end);
    const payload = {
      name,
      description: description.trim() ? description : null,
      location: location.trim() ? location : null,
      // Vazio segue como string vazia: o schema recusa com a mensagem certa do campo.
      startDate: startDate ?? "",
      endDate: endDate ?? "",
      status,
      ...(mode === "edit" && initial ? { baseVersion: initial.version } : {}),
    };

    // Mesma validação do servidor, antes de gastar uma ida à rede.
    const schema = mode === "edit" ? EventUpdateInputSchema : EventInputSchema;
    const checked = schema.safeParse(payload);
    if (!checked.success) {
      setFieldErrors(z.flattenError(checked.error).fieldErrors);
      return;
    }

    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setError(OFFLINE_MESSAGE);
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(mode === "edit" && initial ? `/api/eventos/${initial.id}` : "/api/eventos", {
        method: mode === "edit" ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => null)) as {
        error?: string;
        fieldErrors?: FieldErrors;
        event?: unknown;
      } | null;

      if (res.status === 401) {
        setError("Sua sessão expirou. Entre de novo para salvar: o que você digitou continua aqui.");
        return;
      }
      if (res.status === 422) {
        setFieldErrors(body?.fieldErrors ?? {});
        setError(body?.error ?? "Confira os campos destacados.");
        return;
      }
      if (res.status === 409) {
        setOutdated(true);
        setError(body?.error ?? "Este evento foi alterado por outra pessoa.");
        return;
      }
      if (!res.ok) {
        setError(body?.error ?? "Não foi possível salvar o evento.");
        return;
      }

      const snapshot = EventSnapshotSchema.safeParse(body?.event);
      if (snapshot.success) await mirrorLocally(snapshot.data);
      navigateToDocument(`/eventos/${snapshot.success ? snapshot.data.id : (initial?.id ?? "")}`);
    } catch {
      // `fetch` só rejeita quando a requisição nem chegou ao servidor.
      setError(OFFLINE_MESSAGE);
    } finally {
      setSubmitting(false);
    }
  }

  const fieldError = (field: string) => fieldErrors[field]?.[0];

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="mt-6 space-y-4" aria-label="Dados do evento">
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

      <Field id="event-name" label="Nome do evento" error={fieldError("name")} required>
        <input id="event-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} className={inputClass} />
      </Field>

      <Field id="event-location" label="Local" error={fieldError("location")}>
        <input id="event-location" value={location} onChange={(e) => setLocation(e.target.value)} maxLength={300} className={inputClass} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="event-start" label="Início" error={fieldError("startDate")} required>
          <input id="event-start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} className={inputClass} />
        </Field>
        <Field id="event-end" label="Término" error={fieldError("endDate")} required>
          <input id="event-end" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} className={inputClass} />
        </Field>
      </div>

      <Field id="event-status" label="Situação" error={fieldError("status")}>
        <select
          id="event-status"
          value={status}
          onChange={(e) => setStatus(e.target.value as EventStatus)}
          className={inputClass}
        >
          {EventStatusValues.map((value) => (
            <option key={value} value={value}>
              {EVENT_STATUS_LABEL[value]}
            </option>
          ))}
        </select>
      </Field>

      <Field id="event-description" label="Descrição" error={fieldError("description")}>
        <textarea
          id="event-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={4000}
          rows={4}
          className={inputClass}
        />
      </Field>

      <div className="flex items-center gap-3 pt-2">
        <Button type="submit" disabled={submitting}>
          {submitting ? "Salvando…" : mode === "edit" ? "Salvar alterações" : "Criar evento"}
        </Button>
        <AppLink href={mode === "edit" && initial ? `/eventos/${initial.id}` : "/eventos"} className={buttonClass({ variant: "ghost" })}>
          Cancelar
        </AppLink>
      </div>
    </form>
  );
}

/**
 * Se este aparelho já preparou o evento, a cópia local é atualizada na hora — sem isso a pessoa
 * que acabou de editar abriria o evento e veria o nome antigo até o próximo sincronismo. Os
 * demais aparelhos recebem a edição no pull. Melhor esforço: o IndexedDB indisponível não
 * desfaz um salvamento que já deu certo no servidor.
 */
async function mirrorLocally(snapshot: z.infer<typeof EventSnapshotSchema>): Promise<void> {
  try {
    const db = getDb();
    const local = await db.events.get(snapshot.id);
    if (local) await db.events.put(eventFromSnapshot(snapshot, local));
  } catch {
    // ignora
  }
}
