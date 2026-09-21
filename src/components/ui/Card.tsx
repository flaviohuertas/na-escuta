import type { HTMLAttributes } from "react";

/**
 * As classes de um cartão, para usar também num link (`<AppLink className={cardClass({ interactive: true })}>`).
 * `interactive` acrescenta o retorno ao toque e ao ponteiro; o cartão inteiro é o alvo. Um `<a>` é
 * inline por padrão: quem usa num link passa `block` (ou `flex`) em `className`.
 */
export function cardClass({
  interactive = false,
  className = "",
}: { interactive?: boolean; className?: string } = {}): string {
  const base = "rounded-xl border border-line bg-white p-4";
  const behavior = interactive ? "transition-colors hover:border-brand-300 active:bg-slate-50" : "";
  return `${base} ${behavior} ${className}`.replace(/\s+/g, " ").trim();
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cardClass({ className })} {...props} />;
}
