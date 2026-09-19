"use client";

import { useRef, useState } from "react";
import { AppLink } from "@/components/ui/AppLink";
import { useLiveQuery } from "dexie-react-hooks";
import { getDb } from "@/lib/db/dexie/db";
import type { LocalOccurrence, LocalOccurrenceEvidence } from "@/lib/db/dexie/schema";
import { addOccurrenceEvidence, updateOccurrenceStatus } from "@/lib/repositories/occurrence.repository";
import { getOrCreateDeviceId } from "@/lib/auth/device-id";
import { SyncStatusBadge } from "@/components/sync/SyncStatusBadge";

const STATUS_FLOW: LocalOccurrence["status"][] = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"];
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

export function OccurrenceDetailScreen({
  eventId,
  occurrenceId,
  userId,
  companyId,
}: {
  eventId: string;
  occurrenceId: string;
  userId: string;
  companyId: string;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // `undefined` = ainda carregando; `null` = consulta concluída e a ocorrência não existe neste
  // aparelho (`get()` de id ausente também resolve `undefined`, por isso a normalização).
  const occurrence = useLiveQuery(
    async () => (await getDb().occurrences.get(occurrenceId)) ?? null,
    [occurrenceId]
  );
  const evidence = useLiveQuery(
    async () => {
      const rows = await getDb().occurrenceEvidence.where("occurrenceId").equals(occurrenceId).toArray();
      return rows.filter((e) => !e.deletedAt);
    },
    [occurrenceId],
    [] as LocalOccurrenceEvidence[]
  );

  function ctx() {
    return { userId, companyId, deviceId: getOrCreateDeviceId() };
  }

  async function handleStatusChange(status: LocalOccurrence["status"]) {
    await updateOccurrenceStatus(occurrenceId, status, ctx());
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      await addOccurrenceEvidence(
        occurrenceId,
        { blob: file, fileName: file.name, mimeType: file.type || "application/octet-stream" },
        ctx()
      );
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Não foi possível anexar o arquivo.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  if (occurrence === undefined) {
    return <p className="text-slate-500">Carregando…</p>;
  }

  if (occurrence === null) {
    return (
      <div className="mx-auto max-w-2xl">
        <AppLink href={`/eventos/${eventId}/ocorrencias`} className="text-sm text-brand-600 hover:underline">
          ← Voltar às ocorrências
        </AppLink>
        <h1 className="mt-2 text-xl font-semibold text-slate-900">Ocorrência não encontrada</h1>
        <p className="mt-2 text-sm text-slate-600">
          Esta ocorrência não existe neste aparelho. Ela pode ter sido excluída, ou o evento ainda não
          foi preparado/sincronizado aqui.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <AppLink href={`/eventos/${eventId}/ocorrencias`} className="text-sm text-brand-600 hover:underline">
        ← Voltar às ocorrências
      </AppLink>

      <div className="mt-2 flex items-start justify-between gap-2">
        <h1 className="text-xl font-semibold text-slate-900">{occurrence.title}</h1>
        <SyncStatusBadge status={occurrence.syncStatus} />
      </div>
      <p className="text-xs text-slate-500">Registrada em {formatDateTime(occurrence.occurredAt)}</p>
      {occurrence.description && <p className="mt-2 text-sm text-slate-700">{occurrence.description}</p>}

      <div className="mt-4">
        <span className="block text-xs font-medium text-slate-600">Status</span>
        <div className="mt-1 flex flex-wrap gap-2">
          {STATUS_FLOW.map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => void handleStatusChange(status)}
              className={`rounded-md border px-3 py-1.5 text-sm ${
                occurrence.status === status
                  ? "border-brand-500 bg-brand-50 font-medium text-brand-700"
                  : "border-slate-300 text-slate-600 hover:bg-slate-50"
              }`}
            >
              {STATUS_LABEL[status]}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6">
        <h2 className="text-sm font-medium text-slate-700">Evidências (fotos e documentos)</h2>
        <p className="text-xs text-slate-500">
          Os arquivos ficam neste dispositivo; os metadados (nome, tamanho, checksum) são
          sincronizados para auditoria — o envio do arquivo em si é um passo futuro.
        </p>

        <ul className="mt-2 space-y-1">
          {evidence.map((item) => (
            <li key={item.id} className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
              <span>{item.fileName}</span>
              <SyncStatusBadge status={item.syncStatus} />
            </li>
          ))}
          {evidence.length === 0 && <p className="text-sm text-slate-500">Nenhuma evidência anexada.</p>}
        </ul>

        <div className="mt-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf"
            capture="environment"
            onChange={(e) => void handleFileChange(e)}
            disabled={uploading}
            className="text-sm"
          />
          {uploading && <p className="mt-1 text-xs text-slate-500">Anexando…</p>}
          {uploadError && (
            <p role="alert" className="mt-1 text-sm text-status-error">
              {uploadError}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
