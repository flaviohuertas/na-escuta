/**
 * A marca: um ponto que emite sinal (três arcos que enfraquecem) — "na escuta", como se diz no
 * rádio da produção. `tile` escolhe o fundo do quadrado: `ink` sobre claro, `soft` sobre a tinta.
 */
export function LogoMark({
  size = 32,
  tile = "ink",
  className,
}: {
  size?: number;
  tile?: "ink" | "soft";
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <rect width="64" height="64" rx="16" className={tile === "ink" ? "fill-ink" : "fill-ink-soft"} />
      <circle cx="19" cy="32" r="4.5" className="fill-brand-500" />
      <path d="M25.43 24.34A10 10 0 0 1 25.43 39.66" className="stroke-brand-500" strokeWidth="4.5" strokeLinecap="round" />
      <path d="M31.21 17.45A19 19 0 0 1 31.21 46.55" className="stroke-brand-500" strokeWidth="4.5" strokeLinecap="round" opacity="0.72" />
      <path d="M37 10.55A28 28 0 0 1 37 53.45" className="stroke-brand-500" strokeWidth="4.5" strokeLinecap="round" opacity="0.45" />
    </svg>
  );
}

/** O nome em minúsculas, na fonte de exibição. O tamanho e a cor vêm de quem usa. */
export function Wordmark({ className = "" }: { className?: string }) {
  return <span className={`font-display font-extrabold tracking-[-0.04em] ${className}`}>na escuta</span>;
}
