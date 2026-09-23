"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { callApi } from "@/components/admin/api";
import { buttonClass } from "@/components/ui/Button";

/**
 * Arquivar/reativar um fornecedor (ele nunca é apagado). Arquivar pede uma confirmação que diz o que
 * muda: sai da lista e não recebe vínculos novos, mas os orçamentos e lançamentos que já o citam
 * continuam como estão.
 */
export function SupplierArchiveButton({ supplierId, version, archived }: { supplierId: string; version: number; archived: boolean }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    const result = await callApi("POST", `/api/fornecedores/${supplierId}/arquivo`, { archived: !archived, baseVersion: version });
    setBusy(false);
    setConfirming(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    router.refresh();
  }

  return (
    <div className="mt-4">
      {error && (
        <p role="alert" className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {!archived && confirming ? (
        <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-800">
          <p>Arquivar este fornecedor? Ele sai da lista e não recebe vínculos novos, mas os orçamentos e lançamentos que já o citam continuam como estão. Dá para reativá-lo depois.</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => void run()}
              disabled={busy}
              className={buttonClass({ size: "sm" })}
            >
              Confirmar arquivamento
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className={buttonClass({ variant: "secondary", size: "sm" })}
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => (archived ? void run() : setConfirming(true))}
          disabled={busy}
          className={buttonClass({ variant: "secondary", size: "sm" })}
        >
          {archived ? "Reativar fornecedor" : "Arquivar fornecedor"}
        </button>
      )}
    </div>
  );
}
