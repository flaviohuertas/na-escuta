/**
 * Barra de andamento (feitos de total). É só reforço visual: o número sempre está escrito ao lado
 * ("2/5 itens concluídos"), então a barra fica fora da árvore de acessibilidade.
 */
export function ProgressBar({ done, total, className = "" }: { done: number; total: number; className?: string }) {
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div aria-hidden="true" className={`h-1.5 overflow-hidden rounded-full bg-slate-200 ${className}`.trim()}>
      <div className="h-full rounded-full bg-brand-600" style={{ width: `${percent}%` }} />
    </div>
  );
}
