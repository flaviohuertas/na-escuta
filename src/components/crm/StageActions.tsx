"use client";

import { inputClass } from "@/components/ui/Field";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { callApi } from "@/components/admin/api";
import { STAGE_LABEL, allowedMoves, isOpenStage, type OpportunityStageName } from "@/lib/domain/crm";
import { StageMoveSchema } from "@/lib/domain/crm.schema";

/**
 * Os botões de mover a oportunidade no funil — só os movimentos que o servidor permite
 * (`allowedMoves`, a mesma regra dele). Perder pede o motivo antes. Se outra pessoa mexeu
 * primeiro, o servidor responde 409 e a tela oferece recarregar em vez de sobrescrever.
 */
export function StageActions({
  opportunityId,
  version,
  stage,
  hasEvent,
}: {
  opportunityId: string;
  version: number;
  stage: OpportunityStageName;
  hasEvent: boolean;
}) {
  const router = useRouter();
  const [losing, setLosing] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outdated, setOutdated] = useState(false);

  const moves = allowedMoves(stage, { hasEvent });
  const reopening = !isOpenStage(stage);

  async function move(target: OpportunityStageName) {
    setError(null);
    setOutdated(false);

    const checked = StageMoveSchema.safeParse({ stage: target, lostReason: target === "LOST" ? reason : null, baseVersion: version });
    if (!checked.success) {
      setError(checked.error.issues[0]?.message ?? "Confira a movimentação.");
      return;
    }

    setBusy(true);
    const result = await callApi("POST", `/api/comercial/oportunidades/${opportunityId}/etapa`, checked.data);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      setOutdated(result.status === 409);
      return;
    }
    setLosing(false);
    setReason("");
    router.refresh();
  }

  if (moves.length === 0) return null;

  return (
    <div className="mt-3">
      <p className="text-sm font-medium text-slate-700">{reopening ? "Reabrir" : "Mover para"}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {moves.map((target) => {
          const isLost = target === "LOST";
          return (
            <button
              key={target}
              type="button"
              onClick={() => (isLost ? setLosing((open) => !open) : void move(target))}
              disabled={busy}
              aria-label={`${reopening ? "Reabrir como" : "Mover para"} ${STAGE_LABEL[target]}`}
              aria-expanded={isLost ? losing : undefined}
              className={`rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-60 ${
                target === "WON"
                  ? "border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-100"
                  : isLost
                    ? "border-red-300 bg-red-50 text-red-900 hover:bg-red-100"
                    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              {STAGE_LABEL[target]}
            </button>
          );
        })}
      </div>

      {losing && (
        <div className="mt-3 rounded-md bg-slate-50 p-3">
          <label htmlFor="lost-reason" className="block text-sm font-medium text-slate-700">
            Por que a oportunidade foi perdida?
          </label>
          <textarea
            id="lost-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            rows={2}
            className={inputClass}
          />
          <button
            type="button"
            onClick={() => void move("LOST")}
            disabled={busy}
            className="mt-2 rounded-md bg-red-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-60"
          >
            Confirmar perda
          </button>
        </div>
      )}

      {error && (
        <div role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          <p>{error}</p>
          {outdated && (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-2 rounded-md border border-red-300 bg-white px-3 py-1 text-sm font-medium text-red-700 hover:bg-red-100"
            >
              Carregar a etapa atual
            </button>
          )}
        </div>
      )}
    </div>
  );
}
