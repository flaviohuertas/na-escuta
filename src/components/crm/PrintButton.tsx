"use client";

import { buttonClass } from "@/components/ui/Button";

/** Abre a impressão do navegador — de lá se imprime ou se salva a proposta em PDF. */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className={buttonClass({ variant: "secondary", size: "sm" })}
    >
      Imprimir / salvar em PDF
    </button>
  );
}
