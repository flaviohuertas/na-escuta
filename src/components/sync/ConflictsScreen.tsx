"use client";

import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { getDb } from "@/lib/db/dexie/db";
import type { LocalConflict } from "@/lib/db/dexie/schema";
import { applyConflictResolution } from "@/lib/sync/conflict-resolution";
import { buttonClass } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";

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
  const [notice, setNotice] = useState<string | null>(null);

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
    setNotice(null);
    try {
      const res = await fetch(`/api/sync/conflicts/${conflict.id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ strategy }),
      });
      const body = (await res.json().catch(() => null)) as {
        error?: string;
        entity?: Record<string, unknown> | null;
      } | null;

      if (res.status === 409 && body?.entity) {
        // Outro dispositivo já resolveu: a escolha feita AQUI não vale — converge com o
        // resultado que o servidor tem e avisa, em vez de deixar o conflito preso.
        await applyConflictResolution(getDb(), conflict, body.entity);
        setNotice(
          "Este conflito já tinha sido resolvido em outro dispositivo. A tela foi atualizada com o resultado que está no servidor, e a sua escolha aqui não foi aplicada."
        );
        return;
      }
      if (!res.ok) {
        throw new Error(body?.error ?? "Falha ao resolver o conflito.");
      }
      // Converge a cópia local com o que o servidor tem agora. Com "Manter o servidor" a
      // entidade lá não muda, então o pull nunca a traria de volta.
      await applyConflictResolution(getDb(), conflict, body?.entity ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao resolver o conflito.");
    } finally {
      setResolvingId(null);
    }
  }

  return (
    <div className="max-w-2xl">
      <PageHeader title="Conflitos pendentes" description="Isto exige conexão: a resolução é aplicada e auditada no servidor." />

      {error && (
        <p role="alert" className="mt-2 text-sm text-status-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mt-2 text-sm text-slate-700">
          {notice}
        </p>
      )}

      {conflicts.length === 0 && (
        <div className="mt-4">
          <EmptyState hint="Quando duas pessoas mudam o mesmo dado sem conexão, a escolha de qual versão fica aparece aqui.">
            Nenhum conflito pendente.
          </EmptyState>
        </div>
      )}
      <ul className="mt-4 space-y-3">
        {conflicts.map((conflict) => (
          <li key={conflict.id} className="rounded-xl border border-status-conflict/40 bg-red-50 p-4">
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
                className={buttonClass({ variant: "secondary", size: "sm" })}
              >
                Manter versão do servidor
              </button>
              <button
                type="button"
                disabled={resolvingId === conflict.id}
                onClick={() => void resolve(conflict, "KEEP_CLIENT")}
                className={buttonClass({ size: "sm" })}
              >
                Manter minha versão (deste dispositivo)
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
