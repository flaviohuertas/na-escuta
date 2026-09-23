import type { ReactNode } from "react";
import { cardClass } from "@/components/ui/Card";

export type StatTone = "neutral" | "success" | "warning" | "danger";
export type StatSize = "sm" | "md" | "lg";

// "Números grandes" são da fonte de títulos (identidade Sinal); algarismos de largura fixa para as
// colunas de valores não dançarem.
const SIZE: Record<StatSize, string> = {
  sm: "text-lg",
  md: "text-2xl",
  lg: "text-3xl",
};

const VALUE_TONE: Record<StatTone, string> = {
  neutral: "text-slate-900",
  success: "text-emerald-800",
  warning: "text-amber-800",
  danger: "text-red-700",
};

// Cartão de alerta: a cor aparece no fundo também, para o alerta se destacar dos números neutros ao lado.
const CARD_TONE: Record<StatTone, string> = {
  neutral: "",
  success: "border-emerald-300 bg-emerald-50",
  warning: "border-amber-300 bg-amber-50",
  danger: "border-red-200 bg-red-50",
};

/**
 * Um número de destaque: rótulo em cima, valor grande embaixo e, se houver, notas (`<dd>` de quem usa).
 * Vai dentro de um `<dl>`. `card` o põe num cartão; sem ele, o número fica solto num cartão maior.
 */
export function Stat({
  label,
  value,
  note,
  size = "md",
  tone = "neutral",
  card = false,
  valueTestId,
  className = "",
}: {
  label: ReactNode;
  value: ReactNode;
  note?: ReactNode;
  size?: StatSize;
  tone?: StatTone;
  card?: boolean;
  valueTestId?: string;
  className?: string;
}) {
  const box = card ? cardClass({ className: CARD_TONE[tone] }) : "";
  return (
    <div className={`${box} ${className}`.trim() || undefined}>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd
        className={`mt-1 font-display font-extrabold tabular-nums tracking-[-0.02em] ${SIZE[size]} ${VALUE_TONE[tone]}`}
        data-testid={valueTestId}
      >
        {value}
      </dd>
      {note}
    </div>
  );
}

/**
 * Valor que não existe (sem previsão, sem receita). O traço é só para quem vê; o leitor de tela ouve
 * o motivo, em vez de "travessão".
 */
export function NoValue({ label = "sem valor" }: { label?: string }) {
  return (
    <>
      {/* Leve e cinza: dentro de um `Stat` o traço herdaria o peso do número e pareceria um valor. */}
      <span aria-hidden="true" className="font-normal text-slate-400">
        —
      </span>
      <span className="sr-only">{label}</span>
    </>
  );
}
