"use client";

/** Abre a impressão do navegador — de lá se imprime ou se salva a proposta em PDF. */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
    >
      Imprimir / salvar em PDF
    </button>
  );
}
