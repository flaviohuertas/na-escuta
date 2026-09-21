import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50";

const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700",
  secondary: "border-[1.5px] border-ink bg-transparent text-ink hover:bg-slate-100",
  ghost: "text-slate-700 hover:bg-slate-100",
  danger: "bg-status-error text-white hover:opacity-90",
};

// `md` tem 44 px de altura, o mínimo recomendado para toque; `sm` é para telas de escritório.
const SIZE: Record<ButtonSize, string> = {
  sm: "h-9 px-3 text-sm",
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

export function Button({
  variant,
  size,
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button type={type} className={buttonClass({ variant, size, className })} {...props} />;
}
