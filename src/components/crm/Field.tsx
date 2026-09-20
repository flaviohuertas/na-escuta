import type { ReactNode } from "react";

export const inputClass =
  "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200";

/** Rótulo + campo + erro do campo (com `role="alert"`, como os outros formulários do app). */
export function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">
        {label}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-1 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

/** Junta os erros do Zod por campo (o primeiro de cada um), pelo primeiro nível do caminho. */
export function issuesByField(issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>): Partial<Record<string, string>> {
  const problems: Partial<Record<string, string>> = {};
  for (const issue of issues) {
    const field = String(issue.path[0] ?? "");
    problems[field] ??= issue.message;
  }
  return problems;
}
