import type { ReactNode } from "react";

/** Lista vazia: diz o que falta e o que fazer. Nunca vai dentro de `<ul>`. */
export function EmptyState({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-400 px-4 py-6 text-center">
      <p className="text-sm font-semibold text-slate-700">{children}</p>
      {hint && <p className="mt-1 text-sm text-slate-600">{hint}</p>}
    </div>
  );
}

/** Enquanto o aparelho lê os dados locais. Some sozinho: a leitura é do IndexedDB, não da rede. */
export function LoadingLine() {
  return (
    <p role="status" className="text-sm text-slate-600">
      Carregando…
    </p>
  );
}
