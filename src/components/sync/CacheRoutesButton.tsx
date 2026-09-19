"use client";

import { useState } from "react";
import { warmEventRoutes } from "@/lib/offline/warm-routes";

/**
 * Os DADOS do evento já estão no aparelho, mas as TELAS (HTML) não estão no cache do
 * navegador — ex.: o navegador limpou o cache, ou o Service Worker ainda não estava ativo
 * quando o evento foi preparado. Sem elas, reabrir o app sem internet falha.
 */
export function CacheRoutesButton({ eventId, onDone }: { eventId: string; onDone: () => void }) {
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleClick() {
    setRunning(true);
    setMessage(null);
    try {
      const result = await warmEventRoutes(eventId);
      if (result.failed.length === 0) {
        onDone();
        return;
      }
      setMessage(
        result.serviceWorkerActive
          ? "Não foi possível guardar todas as telas. Verifique a conexão e sua sessão, e tente de novo."
          : "O Service Worker ainda não está ativo neste navegador (ou está desligado neste ambiente). Recarregue a página com conexão e tente de novo."
      );
    } finally {
      setRunning(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => void handleClick()}
        disabled={running}
        className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
      >
        {running ? "Guardando telas…" : "Guardar telas para uso sem internet"}
      </button>
      {message && (
        <p role="alert" className="mt-2 text-sm text-status-error">
          {message}
        </p>
      )}
    </div>
  );
}
