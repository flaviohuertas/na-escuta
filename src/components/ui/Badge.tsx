import type { HTMLAttributes } from "react";

export type BadgeTone = "neutral" | "success" | "warning" | "danger" | "brand";

// Cor só quando ela diz algo: desfecho bom (verde-mar), atenção (âmbar), desfecho ruim (vermelho) e o que
// está em curso agora (marca: tarefa em andamento, sincronizando, proposta enviada esperando o cliente).
// Etapa do funil em andamento, rascunho e papel da pessoa são `neutral`. Não há azul: um acento só.
const TONE: Record<BadgeTone, string> = {
  neutral: "bg-slate-100 text-slate-700",
  success: "bg-emerald-100 text-emerald-900",
  warning: "bg-amber-100 text-amber-900",
  danger: "bg-red-100 text-red-800",
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
