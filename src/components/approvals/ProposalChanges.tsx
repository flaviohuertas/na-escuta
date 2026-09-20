import { formatChangeValue } from "@/lib/domain/approval-format";
import type { FieldChangeView } from "@/lib/domain/approval";

/**
 * O que uma proposta muda, campo a campo: o valor que a pessoa via, o que ela propõe e — se o
 * evento mudou neste campo depois da proposta — o valor de agora, destacado. Sem estado nem
 * navegador: serve às telas do servidor e do cliente.
 */
export function ProposalChanges({ changes, showConflicts }: { changes: FieldChangeView[]; showConflicts: boolean }) {
  return (
    <ul className="mt-2 divide-y divide-slate-100 rounded-md border border-slate-200 bg-white text-sm">
      {changes.map((change) => {
        const conflict = showConflicts && change.conflict;
        return (
          <li key={change.field} className="grid gap-1 px-3 py-2 sm:grid-cols-[7rem_1fr]" data-field={change.field}>
            <span className="font-medium text-slate-700">{change.label}</span>
            <span className="min-w-0 break-words">
              <span className="text-slate-500 line-through decoration-slate-300">
                {formatChangeValue(change.field, change.before)}
              </span>
              <span aria-hidden="true" className="px-1.5 text-slate-400">
                →
              </span>
              <span className="sr-only"> para </span>
              <strong className="text-slate-900">{formatChangeValue(change.field, change.proposed)}</strong>
              {conflict && (
                <span className="mt-1 block rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">
                  Mudou depois da proposta: agora está como <strong>{formatChangeValue(change.field, change.current)}</strong>.
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
