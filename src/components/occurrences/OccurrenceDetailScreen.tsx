"use client";

import { useId, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { getDb } from "@/lib/db/dexie/db";
import type { LocalOccurrence } from "@/lib/db/dexie/schema";
import { addOccurrenceEvidence, updateOccurrenceStatus } from "@/lib/repositories/occurrence.repository";
import { getOrCreateDeviceId } from "@/lib/auth/device-id";
import { SyncStatusBadge } from "@/components/sync/SyncStatusBadge";
import { EmptyState, LoadingLine } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { PageHeader } from "@/components/ui/PageHeader";

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
  const statusId = useId();
  const fileId = useId();
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // `undefined` = ainda carregando; `null` = consulta concluída e a ocorrência não existe neste
  // aparelho (`get()` de id ausente também resolve `undefined`, por isso a normalização).
  const occurrence = useLiveQuery(
    async () => (await getDb().occurrences.get(occurrenceId)) ?? null,
    [occurrenceId]
  );
  const evidence = useLiveQuery(async () => {
    const rows = await getDb().occurrenceEvidence.where("occurrenceId").equals(occurrenceId).toArray();
    return rows.filter((e) => !e.deletedAt);
  }, [occurrenceId]);

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
    return <LoadingLine />;
  }

  const back = { href: `/eventos/${eventId}/ocorrencias`, label: "Voltar às ocorrências" };

  if (occurrence === null) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader title="Ocorrência não encontrada" back={back} />
        <p className="mt-2 text-sm text-slate-600">
          Esta ocorrência não existe neste aparelho. Ela pode ter sido excluída, ou o evento ainda não
          foi preparado/sincronizado aqui.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title={occurrence.title}
        back={back}
        description={`Registrada em ${formatDateTime(occurrence.occurredAt)}`}
        actions={<SyncStatusBadge status={occurrence.syncStatus} />}
      />
      {occurrence.description && <p className="mt-3 text-base text-slate-700 [overflow-wrap:anywhere]">{occurrence.description}</p>}

      <div role="group" aria-labelledby={statusId} className="mt-6">
        <h2 id={statusId} className="text-lg text-slate-900">
          Status
        </h2>
        <div className="mt-2 flex flex-wrap gap-2">
          {STATUS_FLOW.map((status) => {
            const current = occurrence.status === status;
            return (
              <button
                key={status}
                type="button"
                aria-pressed={current}
                onClick={() => void handleStatusChange(status)}
                className={`inline-flex min-h-11 items-center gap-1.5 rounded-xl border-[1.5px] px-4 text-base font-semibold transition-colors ${
                  current
                    ? "border-brand-600 bg-brand-50 text-brand-800"
                    : "border-slate-400 bg-white text-slate-700 hover:bg-slate-100"
                }`}
              >
                {current && <Icon name="check" size={18} />}
                {STATUS_LABEL[status]}
              </button>
            );
          })}
        </div>
      </div>

      <section className="mt-8">
        <h2 className="text-lg text-slate-900">Evidências (fotos e documentos)</h2>
        <p className="mt-1 text-sm text-slate-600">
          Os arquivos ficam neste dispositivo; os metadados (nome, tamanho, checksum) são
          sincronizados para auditoria — o envio do arquivo em si é um passo futuro.
        </p>

        <div className="mt-3">
          {evidence === undefined ? (
            <LoadingLine />
          ) : evidence.length === 0 ? (
            <EmptyState hint="Use o botão abaixo para tirar uma foto ou escolher um arquivo.">Nenhuma evidência anexada.</EmptyState>
          ) : (
            <ul className="space-y-2">
              {evidence.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center justify-between gap-2 rounded-xl border border-line bg-white px-3 py-2 text-base"
                >
                  <span className="min-w-0 [overflow-wrap:anywhere]">{item.fileName}</span>
                  <SyncStatusBadge status={item.syncStatus} />
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-4">
          <label htmlFor={fileId} className="block text-sm font-medium text-slate-700">
            Anexar foto ou documento
          </label>
          <input
            id={fileId}
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf"
            capture="environment"
            onChange={(e) => void handleFileChange(e)}
            disabled={uploading}
            className="mt-1 block w-full text-base text-slate-700 file:mr-3 file:h-11 file:cursor-pointer file:rounded-xl file:border-0 file:bg-slate-100 file:px-4 file:text-base file:font-semibold file:text-slate-900 hover:file:bg-slate-200"
          />
          {uploading && (
            <p role="status" className="mt-2 text-sm text-slate-600">
              Anexando…
            </p>
          )}
          {uploadError && (
            <p role="alert" className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {uploadError}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
