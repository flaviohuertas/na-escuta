"use client";

import { useState } from "react";
import { getDb } from "@/lib/db/dexie/db";
import { prepareEventForOffline, type PrepareProgress, type PrepareResult } from "@/lib/sync/bootstrap";
import { requestPersistentStorage } from "@/lib/storage/persistence";
import { warmEventRoutes } from "@/lib/offline/warm-routes";

export function PrepareOfflineButton({ eventId, onDone }: { eventId: string; onDone?: () => void }) {
  const [progress, setProgress] = useState<PrepareProgress | null>(null);
  const [result, setResult] = useState<PrepareResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isRunning = progress != null && progress.phase !== "done" && progress.phase !== "error";

  async function handlePrepare() {
    setError(null);
    setResult(null);
    try {
      await requestPersistentStorage();
      const db = getDb();
      const res = await prepareEventForOffline(db, eventId, {
        onProgress: setProgress,
        warmRoutes: (id) => warmEventRoutes(id),
      });
      setResult(res);
      if (res.ok) onDone?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao preparar o evento.");
    }
  }

  const pct =
    progress && progress.expected > 0
      ? Math.min(100, Math.round((progress.downloaded / progress.expected) * 100))
      : progress?.phase === "verifying" || progress?.phase === "caching"
        ? 100
        : 0;

  return (
    <div>
      <button
        type="button"
        onClick={() => void handlePrepare()}
        disabled={isRunning}
        className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
      >
        {isRunning ? "Preparando…" : "Preparar evento para uso offline"}
      </button>

      {progress && (
        <div className="mt-3">
          <div className="h-2 w-full max-w-xs overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full bg-brand-500 transition-all"
              style={{ width: `${pct}%` }}
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {progress.phase === "starting" && "Iniciando…"}
            {progress.phase === "downloading" &&
              `Baixando dados (${progress.downloaded}${progress.expected ? ` de ${progress.expected}` : ""})…`}
            {progress.phase === "verifying" && "Verificando se tudo foi baixado…"}
            {progress.phase === "caching" && "Guardando as telas para abrir sem internet…"}
            {progress.phase === "done" && "Concluído."}
            {progress.phase === "error" && "Falhou."}
          </p>
        </div>
      )}

      {result && !result.ok && (
        <p role="alert" className="mt-2 text-sm text-status-error">
          A verificação encontrou divergências em: {result.mismatched.join(", ")}. Tente novamente
          com uma conexão estável antes de ir a campo sem internet.
        </p>
      )}
      {result?.ok && (
        <p className="mt-2 text-sm text-status-synced">
          Evento preparado com sucesso — já pode ser usado sem internet.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-status-error">
          {error}
        </p>
      )}
    </div>
  );
}
