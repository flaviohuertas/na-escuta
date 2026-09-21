"use client";

import { useState, type FormEvent } from "react";
import { AppLink } from "@/components/ui/AppLink";
import { occurrenceDetailHref } from "@/lib/offline/routes";
import { useLiveQuery } from "dexie-react-hooks";
import { getDb } from "@/lib/db/dexie/db";
import type { LocalOccurrence } from "@/lib/db/dexie/schema";
import { createOccurrence } from "@/lib/repositories/occurrence.repository";
import { getOrCreateDeviceId } from "@/lib/auth/device-id";
import { SyncStatusBadge } from "@/components/sync/SyncStatusBadge";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, cardClass } from "@/components/ui/Card";
import { EmptyState, LoadingLine } from "@/components/ui/EmptyState";
import { Field, inputClass } from "@/components/ui/Field";
import { PageHeader } from "@/components/ui/PageHeader";

const SEVERITY_LABEL: Record<LocalOccurrence["severity"], string> = {
  LOW: "Baixa",
  MEDIUM: "Média",
  HIGH: "Alta",
  CRITICAL: "Crítica",
};

const SEVERITY_TONE: Record<LocalOccurrence["severity"], BadgeTone> = {
  LOW: "neutral",
  MEDIUM: "warning",
  HIGH: "brand",
  CRITICAL: "danger",
};

const STATUS_LABEL: Record<LocalOccurrence["status"], string> = {
  OPEN: "Aberta",
  IN_PROGRESS: "Em andamento",
  RESOLVED: "Resolvida",
  CLOSED: "Encerrada",
};

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function OccurrencesScreen({
  eventId,
  userId,
  companyId,
}: {
  eventId: string;
  userId: string;
  companyId: string;
}) {
  const [title, setTitle] = useState("");
  const [severity, setSeverity] = useState<LocalOccurrence["severity"]>("LOW");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // `undefined` = o aparelho ainda está lendo; a lista vazia só aparece depois da leitura.
  const occurrences = useLiveQuery(async () => {
    const db = getDb();
    const rows = await db.occurrences.where("eventId").equals(eventId).toArray();
    return rows.filter((o) => !o.deletedAt).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  }, [eventId]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    setFormError(null);
    try {
      await createOccurrence(
        {
          eventId,
          title: title.trim(),
          description: description.trim() || null,
          severity,
          occurredAt: new Date().toISOString(),
        },
        { userId, companyId, deviceId: getOrCreateDeviceId() }
      );
      setTitle("");
      setDescription("");
      setSeverity("LOW");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Não foi possível registrar a ocorrência.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Ocorrências" back={{ href: `/eventos/${eventId}`, label: "Voltar ao evento" }} />

      <Card className="mt-4">
        <form onSubmit={handleCreate} className="space-y-3">
          <Field id="occurrence-title" label="Título">
            <input
              id="occurrence-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex.: Queda de energia no palco 2"
              className={inputClass}
              required
            />
          </Field>
          <Field id="occurrence-description" label="Descrição (opcional)">
            <textarea
              id="occurrence-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className={inputClass}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <Field id="occurrence-severity" label="Gravidade">
              <select
                id="occurrence-severity"
                value={severity}
                onChange={(e) => setSeverity(e.target.value as LocalOccurrence["severity"])}
                className={inputClass}
              >
                {Object.entries(SEVERITY_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Button type="submit" disabled={submitting} className="w-full sm:w-auto">
              Registrar ocorrência
            </Button>
          </div>
        </form>
        {formError && (
          <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {formError}
          </p>
        )}
      </Card>

      <div className="mt-4">
        {occurrences === undefined ? (
          <LoadingLine />
        ) : occurrences.length === 0 ? (
          <EmptyState hint="Quando algo sair do previsto, registre aqui.">Nenhuma ocorrência registrada.</EmptyState>
        ) : (
          <ul className="space-y-3">
            {occurrences.map((occurrence) => (
              <li key={occurrence.id}>
                <AppLink
                  href={occurrenceDetailHref(eventId, occurrence.id)}
                  className={cardClass({ interactive: true, className: "block" })}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="min-w-0 flex-1 font-semibold text-slate-900 [overflow-wrap:anywhere]">{occurrence.title}</p>
                    <div className="flex items-center gap-2">
                      <Badge tone={SEVERITY_TONE[occurrence.severity]}>{SEVERITY_LABEL[occurrence.severity]}</Badge>
                      <SyncStatusBadge status={occurrence.syncStatus} />
                    </div>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">
                    {STATUS_LABEL[occurrence.status]} · {formatDateTime(occurrence.occurredAt)}
                  </p>
                </AppLink>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
