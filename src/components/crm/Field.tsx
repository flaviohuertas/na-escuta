// O `Field` e o `inputClass` moram em `components/ui/Field.tsx` (usados por todo o app). Este arquivo
// mantém o caminho antigo dos formulários do comercial, do financeiro e de fornecedores.
export { Field, RequiredNote, compactSelectClass, inputClass } from "@/components/ui/Field";

/** Junta os erros do Zod por campo (o primeiro de cada um), pelo primeiro nível do caminho. */
export function issuesByField(issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>): Partial<Record<string, string>> {
  const problems: Partial<Record<string, string>> = {};
  for (const issue of issues) {
    const field = String(issue.path[0] ?? "");
    problems[field] ??= issue.message;
  }
  return problems;
}
