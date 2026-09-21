"use client";

import { inputClass } from "@/components/ui/Field";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { callApi } from "@/components/admin/api";
import { MAX_VOID_REASON } from "@/lib/domain/finance";
import { ExpenseVoidSchema } from "@/lib/domain/finance.schema";

/**
 * Estornar um lançamento: dinheiro nunca se apaga, então o botão pede o MOTIVO e o lançamento
 * continua na lista, riscado, fora dos totais. Se outra pessoa mexeu antes (409), a tela avisa e
 * oferece recarregar.
 */
export function VoidExpenseButton({ expenseId, version, description }: { expenseId: string; version: number; description: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outdated, setOutdated] = useState(false);

  async function confirm() {
    setError(null);
    setOutdated(false);
    const checked = ExpenseVoidSchema.safeParse({ reason, baseVersion: version });
    if (!checked.success) {
      setError(checked.error.issues[0]?.message ?? "Confira o motivo.");
      return;
    }
    setBusy(true);
    const result = await callApi("POST", `/api/financeiro/lancamentos/${expenseId}/estorno`, checked.data);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      setOutdated(result.status === 409);
      return;
    }
    setOpen(false);
    setReason("");
    router.refresh();
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Estornar ${description}`}
        className="rounded-md border border-red-300 bg-white px-2 py-1 text-xs font-medium text-red-800 hover:bg-red-50"
      >
        Estornar
      </button>
    );
  }

  return (
    <div className="mt-2 w-full rounded-md bg-slate-50 p-3 text-left" data-testid="void-panel">
      <p className="text-sm text-slate-700">O lançamento continua na lista, riscado, e sai dos totais. Isto não apaga nada.</p>
      <label htmlFor={`void-reason-${expenseId}`} className="mt-2 block text-sm font-medium text-slate-700">
        Por que estornar {description}?
      </label>
      <textarea
        id={`void-reason-${expenseId}`}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={MAX_VOID_REASON}
        rows={2}
        className={inputClass}
      />
      <div className="mt-2 flex items-center gap-2">
        <button type="button" onClick={() => void confirm()} disabled={busy} className="rounded-md bg-red-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-60">
          {busy ? "Estornando…" : "Confirmar estorno"}
        </button>
        <button type="button" onClick={() => setOpen(false)} disabled={busy} className="text-sm text-slate-600 hover:text-slate-900">
          Cancelar
        </button>
      </div>
      {error && (
        <div role="alert" className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          <p>{error}</p>
          {outdated && (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-2 rounded-md border border-red-300 bg-white px-3 py-1 text-sm font-medium text-red-700 hover:bg-red-100"
            >
              Carregar os dados atuais
            </button>
          )}
        </div>
      )}
    </div>
  );
}
