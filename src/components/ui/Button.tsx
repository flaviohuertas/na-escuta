import type { ComponentProps } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "ghost-danger";
export type ButtonSize = "sm" | "md";

// `hover:transition-colors`, não `transition-colors`: a transição vale ao ganhar o ponteiro, mas habilitar
// e desabilitar (cinza ↔ laranja, "Salvando…") é instantâneo. Animado, o botão passava ~150 ms numa cor
// intermediária sem contraste (o axe mediu 4,2:1 no meio da troca).
const BASE =
  "inline-flex items-center justify-center gap-2 rounded-xl font-semibold hover:transition-colors disabled:cursor-not-allowed";

// Desabilitado é NEUTRO em todas as variantes: com `opacity-50` o laranja virava salmão (uma cor fora da
// paleta) e o vermelho, rosa. `disabled:hover:` anula o retorno de passar o ponteiro.
const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 disabled:bg-slate-200 disabled:text-slate-500 disabled:hover:bg-slate-200",
  secondary:
    "border-[1.5px] border-ink bg-transparent text-ink hover:bg-slate-100 disabled:border-slate-300 disabled:text-slate-500 disabled:hover:bg-transparent",
  ghost: "text-slate-700 hover:bg-slate-100 disabled:text-slate-400 disabled:hover:bg-transparent",
  danger: "bg-status-error text-white hover:bg-red-800 disabled:bg-slate-200 disabled:text-slate-500 disabled:hover:bg-slate-200",
  // Ação destrutiva de segundo plano (ex.: "Excluir" ao lado de outra ação): vermelho, sem preenchimento.
  "ghost-danger": "text-status-error hover:bg-red-50 disabled:text-slate-400 disabled:hover:bg-transparent",
};

// `md` tem 44 px de altura, o mínimo recomendado para toque. `sm` é o compacto das telas de escritório
// (ações de linha, filtros), mas só a partir de 640 px: no celular ele também tem 44 px, porque
// Comercial e Financeiro estão nas abas do celular e são tocados com o dedo.
const SIZE: Record<ButtonSize, string> = {
  sm: "h-11 px-4 text-base sm:h-9 sm:px-3 sm:text-sm",
  md: "h-11 px-5 text-base",
};

/**
 * As classes de um botão, para usar também num link (`<AppLink className={buttonClass()}>`).
 * `className` serve só para layout (`w-full`, `ml-auto`): cor e tamanho vêm da variante.
 */
export function buttonClass({
  variant = "primary",
  size = "md",
  className = "",
}: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}): string {
  return `${BASE} ${VARIANT[variant]} ${SIZE[size]} ${className}`.trim();
}

/** `ref` chega como propriedade comum (React 19), então serve também para devolver o foco a um botão. */
export function Button({
  variant,
  size,
  className,
  type = "button",
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button type={type} className={buttonClass({ variant, size, className })} {...props} />;
}
