"use client";

import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { getDb } from "@/lib/db/dexie/db";
import type { LocalConflict } from "@/lib/db/dexie/schema";

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function fieldDiff(client: Record<string, unknown>, server: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(client), ...Object.keys(server)]);
  const diffs: string[] = [];
  for (const key of keys) {
    if (["id", "version", "createdAt", "updatedAt", "companyId", "eventId"].includes(key)) continue;
    const a = client[key];
    const b = server[key];
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      diffs.push(`${key}: "${String(a)}" (seu dispositivo) vs. "${String(b)}" (servidor)`);
    }
  }
  return diffs;
}

/**
 * Resolução manual e auditada de conflitos: nunca aplica "última gravação
 * vence" automaticamente. A escolha (manter servidor / manter dispositivo)
 * é enviada ao backend, que registra quem resolveu e quando (AuditLog).
 */
export function ConflictsScreen() {
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const conflicts = useLiveQuery(
    async () => {
      const rows = await getDb().conflicts.where("status").equals("PENDING").toArray();
      return rows.sort((a, b) => b.detectedAt.localeCompare(a.detectedAt));
    },
    [],
    [] as LocalConflict[]
  );

  async function resolve(conflict: LocalConflict, strategy: "KEEP_SERVER" | "KEEP_CLIENT") {
    setResolvingId(conflict.id);
    setError(null);
    try {
      const res = await fetch(`/api/sync/conflicts/${conflict.id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ strategy }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Falha ao resolver o conflito." }));
        throw new Error(body.error ?? "Falha ao resolver o conflito.");
      }
      // Limpeza otimista local — a próxima sincronização também confirma isso via pull.
      await getDb().conflicts.update(conflict.id, {
        status: "RESOLVED",
        resolvedAt: new Date().toISOString(),
      });
      await getDb().outbox.delete(conflict.operationId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao resolver o conflito.");
    } finally {
      setResolvingId(null);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-xl font-semibold text-slate-900">Conflitos pendentes</h1>
      <p className="mt-1 text-sm text-slate-500">
        Isto exige conexão — a resolução é aplicada e auditada no servidor.
      </p>

      {error && (
        <p role="alert" className="mt-2 text-sm text-status-error">
          {error}
        </p>
      )}

      <ul className="mt-4 space-y-3">
        {conflicts.map((conflict) => (
          <li key={conflict.id} className="rounded-lg border border-status-conflict/40 bg-red-50 p-4">
            <p className="text-sm font-medium text-slate-900">
              {conflict.entityType} · detectado em {formatDateTime(conflict.detectedAt)}
            </p>
            <ul className="mt-2 space-y-0.5 text-xs text-slate-700">
              {fieldDiff(conflict.clientPayload, conflict.serverPayload).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={resolvingId === conflict.id}
                onClick={() => void resolve(conflict, "KEEP_SERVER")}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50"
              >
                Manter versão do servidor
              </button>
              <button
                type="button"
                disabled={resolvingId === conflict.id}
                onClick={() => void resolve(conflict, "KEEP_CLIENT")}
                className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
              >
                Manter minha versão (deste dispositivo)
              </button>
            </div>
          </li>
        ))}
        {conflicts.length === 0 && (
          <p className="text-sm text-slate-500">Nenhum conflito pendente.</p>
        )}
      </ul>
    </div>
  );
}
