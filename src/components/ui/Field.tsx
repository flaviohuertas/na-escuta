import { cloneElement, Fragment, isValidElement, type ReactElement, type ReactNode } from "react";

/**
 * Campo de texto, seleção e área de texto. A borda é `slate-400` (4,6:1 sobre o papel): o WCAG 1.4.11
 * pede 3:1 para quem enxerga pouco reconhecer onde o campo começa, e `slate-300` dava 1,5:1. O foco
 * é o contorno global do `globals.css`. Tamanho de 16 px: abaixo disso o Safari do iPhone dá zoom na tela.
 */
export const inputClass =
  "mt-1 block w-full rounded-lg border border-slate-400 bg-white px-3 py-2 text-base text-ink placeholder:text-slate-500 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500";

/** Seleção compacta de tabelas de gestão (papel da pessoa, acesso ao evento): mesma borda, altura menor. */
export const compactSelectClass =
  "rounded-lg border border-slate-400 bg-white px-2 py-1.5 text-sm text-ink disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500";

interface ControlProps {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
  "aria-required"?: boolean | "true" | "false";
}

/**
 * Rótulo + campo + dica + erro. Liga o campo ao erro e à dica (`aria-describedby`), marca `aria-invalid`
 * quando há erro e `aria-required` quando é obrigatório — o leitor de tela anuncia tudo ao chegar no
 * campo, não só quando o erro aparece. Só `aria-required`, não `required`: a validação nativa do
 * navegador continua desligada nos formulários que usam `noValidate`.
 *
 * O `*` fica fora do `<label>` para não entrar no nome do campo; o formulário explica o símbolo com `RequiredNote`.
 */
export function Field({
  id,
  label,
  error,
  hint,
  required = false,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
}) {
  const hintId = hint && !error ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;

  const control =
    isValidElement<ControlProps>(children) && children.type !== Fragment
      ? cloneElement(children as ReactElement<ControlProps>, {
          id: children.props.id ?? id,
          "aria-describedby": [children.props["aria-describedby"], hintId, errorId].filter(Boolean).join(" ") || undefined,
          "aria-invalid": error ? true : children.props["aria-invalid"],
          "aria-required": required ? true : children.props["aria-required"],
        })
      : children;

  return (
    <div>
      <div className="flex items-baseline gap-1">
        <label htmlFor={id} className="block text-sm font-medium text-slate-700">
          {label}
        </label>
        {required && (
          <span aria-hidden="true" className="text-sm font-semibold text-status-error">
            *
          </span>
        )}
      </div>
      {control}
      {hintId && (
        <p id={hintId} className="mt-1 text-sm text-slate-600">
          {hint}
        </p>
      )}
      {errorId && (
        <p id={errorId} role="alert" className="mt-1 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

/** A explicação do `*`, no começo de um formulário que tem campo obrigatório. */
export function RequiredNote() {
  return (
    <p className="text-sm text-slate-600">
      <span aria-hidden="true" className="font-semibold text-status-error">
        *
      </span>{" "}
      Campo obrigatório
    </p>
  );
}
