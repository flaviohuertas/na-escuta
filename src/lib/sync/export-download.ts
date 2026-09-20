import type { EncryptedExport } from "./export-pending";

/** Entrega o arquivo cifrado ao navegador como um download. Devolve o nome do arquivo. */
export function downloadEncryptedExport(encrypted: EncryptedExport, filePrefix = "na-escuta-pendencias"): string {
  const blob = new Blob([JSON.stringify(encrypted, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const fileName = `${filePrefix}-${new Date().toISOString().slice(0, 10)}.json`;
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
  return fileName;
}
