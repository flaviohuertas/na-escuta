"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { getDb } from "@/lib/db/dexie/db";
import type { LocalOccurrence } from "@/lib/db/dexie/schema";
import { createOccurrence } from "@/lib/repositories/occurrence.repository";
import { getOrCreateDeviceId } from "@/lib/auth/device-id";
import { SyncStatusBadge } from "@/components/sync/SyncStatusBadge";

const SEVERITY_LABEL: Record<LocalOccurrence["severity"], string> = {
  LOW: "Baixa",
  MEDIUM: "Média",
  HIGH: "Alta",
  CRITICAL: "Crítica",
};

const SEVERITY_COLOR: Record<LocalOccurrence["severity"], string> = {
  LOW: "bg-slate-100 text-slate-700",
  MEDIUM: "bg-amber-100 text-amber-800",
  HIGH: "bg-orange-100 text-orange-800",
  CRITICAL: "bg-red-100 text-red-800",
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

  const occurrences = useLiveQuery(
    async () => {
      const db = getDb();
      const rows = await db.occurrences.where("eventId").equals(eventId).toArray();
      return rows.filter((o) => !o.deletedAt).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    },
    [eventId],
    [] as LocalOccurrence[]
  );

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
      <Link href={`/eventos/${eventId}`} className="text-sm text-brand-600 hover:underline">
        ← Voltar ao evento
      </Link>
      <h1 className="mt-2 text-xl font-semibold text-slate-900">Ocorrências</h1>

      <form onSubmit={handleCreate} className="mt-4 space-y-2 rounded-lg border border-slate-200 bg-white p-3">
        <div>
          <label htmlFor="occurrence-title" className="block text-xs font-medium text-slate-600">
            Título
          </label>
          <input
            id="occurrence-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ex.: Queda de energia no palco 2"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            required
          />
        </div>
        <div>
          <label htmlFor="occurrence-description" className="block text-xs font-medium text-slate-600">
            Descrição (opcional)
          </label>
          <textarea
            id="occurrence-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="flex items-end justify-between gap-2">
          <div>
            <label htmlFor="occurrence-severity" className="block text-xs font-medium text-slate-600">
              Gravidade
            </label>
            <select
              id="occurrence-severity"
              value={severity}
              onChange={(e) => setSeverity(e.target.value as LocalOccurrence["severity"])}
              className="mt-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              {Object.entries(SEVERITY_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            Registrar ocorrência
          </button>
        </div>
      </form>
      {formError && (
        <p role="alert" className="mt-2 text-sm text-status-error">
          {formError}
        </p>
      )}

      <ul className="mt-4 space-y-2">
        {occurrences.map((occurrence) => (
          <li key={occurrence.id}>
            <Link
              href={`/eventos/${eventId}/ocorrencias/${occurrence.id}`}
              className="block rounded-lg border border-slate-200 bg-white p-3 hover:border-brand-300"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium text-slate-900">{occurrence.title}</p>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${SEVERITY_COLOR[occurrence.severity]}`}>
                    {SEVERITY_LABEL[occurrence.severity]}
                  </span>
                  <SyncStatusBadge status={occurrence.syncStatus} />
                </div>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {STATUS_LABEL[occurrence.status]} · {formatDateTime(occurrence.occurredAt)}
              </p>
            </Link>
          </li>
        ))}
        {occurrences.length === 0 && <p className="text-sm text-slate-500">Nenhuma ocorrência registrada.</p>}
      </ul>
    </div>
  );
}
