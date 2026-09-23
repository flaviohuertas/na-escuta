"use client";

import { inputClass } from "@/components/ui/Field";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { callApi } from "@/components/admin/api";
import { STAGE_LABEL, allowedMoves, isOpenStage, type OpportunityStageName } from "@/lib/domain/crm";
import { StageMoveSchema } from "@/lib/domain/crm.schema";
import { buttonClass } from "@/components/ui/Button";

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

  // Ganho e Perdido são desfecho: levam a cor dele, na mesma forma e tamanho do botão `sm` do sistema.
  const OUTCOME_SHAPE =
    "inline-flex h-11 items-center justify-center rounded-xl border-[1.5px] bg-transparent px-4 text-base font-semibold transition-colors disabled:cursor-not-allowed disabled:border-slate-300 disabled:text-slate-500 sm:h-9 sm:px-3 sm:text-sm";

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
              className={
                target === "WON"
                  ? `${OUTCOME_SHAPE} border-emerald-700 text-emerald-900 hover:bg-emerald-50`
                  : isLost
                    ? `${OUTCOME_SHAPE} border-status-error text-red-800 hover:bg-red-50`
                    : buttonClass({ variant: "secondary", size: "sm" })
              }
            >
              {STAGE_LABEL[target]}
            </button>
          );
        })}
      </div>

      {losing && (
        <div className="mt-3 rounded-lg bg-slate-50 p-3">
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
            className={buttonClass({ variant: "danger", size: "sm", className: "mt-2" })}
          >
            Confirmar perda
          </button>
        </div>
      )}

      {error && (
        <div role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          <p>{error}</p>
          {outdated && (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className={buttonClass({ variant: "secondary", size: "sm", className: "mt-2" })}
            >
              Carregar a etapa atual
            </button>
          )}
        </div>
      )}
    </div>
  );
}
