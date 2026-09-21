import type { HTMLAttributes } from "react";

export type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info" | "brand";

// Os mesmos pares de cor que as telas já usavam para situação (estourou, dentro do previsto…).
const TONE: Record<BadgeTone, string> = {
  neutral: "bg-slate-100 text-slate-700",
  success: "bg-emerald-100 text-emerald-900",
  warning: "bg-amber-100 text-amber-900",
  danger: "bg-red-100 text-red-800",
  info: "bg-sky-100 text-sky-900",
  brand: "bg-brand-100 text-brand-800",
};

/** Selo de situação. A cor nunca é a única pista: o texto sempre diz o que é. */
export function Badge({
  tone = "neutral",
  className = "",
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONE[tone]} ${className}`.trim()}
      {...props}
    />
  );
}
