"use client";

import { useId, useRef, useState } from "react";
import { signOut } from "next-auth/react";
import { useLiveQuery } from "dexie-react-hooks";
import { getDb, wipeLocalDatabase } from "@/lib/db/dexie/db";
import { exportPendingChangesEncrypted } from "@/lib/sync/export-pending";
import { clearUserScopedCaches } from "@/lib/offline/warm-routes";

type Step = "confirm" | "export" | "exporting";

/**
 * `className` troca a aparência do botão que abre o diálogo (o padrão é para fundo escuro). O menu
 * tem duas instâncias — barra lateral e "Mais" do celular —, por isso os ids vêm de `useId`.
 */
export function LogoutButton({ className }: { className?: string } = {}) {
  const titleId = useId();
  const passphraseId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [step, setStep] = useState<Step>("confirm");
  const [passphrase, setPassphrase] = useState("");
  const [exportedFileName, setExportedFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pendingCount =
    useLiveQuery(
      async () => {
        const db = getDb();
        return db.outbox.count();
      },
      [],
      0
    ) ?? 0;

  function openDialog() {
    setStep("confirm");
    setError(null);
    setExportedFileName(null);
    dialogRef.current?.showModal();
  }

  function closeDialog() {
    dialogRef.current?.close();
  }

  async function handleExport() {
    if (passphrase.trim().length < 8) {
      setError("Use uma senha de exportação com pelo menos 8 caracteres.");
      return;
    }
    setStep("exporting");
    setError(null);
    try {
      const db = getDb();
      const encrypted = await exportPendingChangesEncrypted(db, passphrase);
      const blob = new Blob([JSON.stringify(encrypted, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const fileName = `na-escuta-pendencias-${new Date().toISOString().slice(0, 10)}.json`;
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
      setExportedFileName(fileName);
      setStep("confirm");
    } catch {
      setError("Não foi possível exportar as alterações pendentes.");
      setStep("export");
    }
  }

  async function handleSignOut(wipe: boolean) {
    if (wipe) {
      await wipeLocalDatabase();
    }
    // O HTML/RSC guardado pelo Service Worker carrega nome e dados do usuário: some em
    // qualquer saída, com ou sem limpar o banco local.
    await clearUserScopedCaches();
    await signOut({ redirectTo: "/login" });
  }

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        className={className ?? "rounded-md border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"}
      >
        Sair
      </button>

      <dialog
        ref={dialogRef}
        className="w-[min(28rem,90vw)] rounded-lg border border-slate-200 p-0 backdrop:bg-black/40"
        aria-labelledby={titleId}
      >
        <div className="p-5">
          <h2 id={titleId} className="text-lg font-semibold text-slate-900">
            Sair da conta
          </h2>

          {pendingCount > 0 ? (
            <p className="mt-2 text-sm text-slate-600">
              Você tem <strong>{pendingCount}</strong> alteração(ões) ainda não sincronizada(s)
              neste dispositivo. Elas serão perdidas se você limpar os dados locais. Recomendamos
              exportar antes de continuar.
            </p>
          ) : (
            <p className="mt-2 text-sm text-slate-600">
              Não há alterações pendentes neste dispositivo.
            </p>
          )}

          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
          {exportedFileName && (
            <p className="mt-2 text-sm text-status-synced">Exportado: {exportedFileName}</p>
          )}

          {step === "export" || step === "exporting" ? (
            <div className="mt-4 space-y-2">
              <label htmlFor={passphraseId} className="block text-sm font-medium text-slate-700">
                Senha para proteger o arquivo exportado
              </label>
              <input
                id={passphraseId}
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2"
                autoFocus
              />
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setStep("confirm")}
                  className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
                >
                  Voltar
                </button>
                <button
                  type="button"
                  onClick={() => void handleExport()}
                  disabled={step === "exporting"}
                  className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                >
                  {step === "exporting" ? "Exportando…" : "Exportar arquivo cifrado"}
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={closeDialog}
                className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
              >
                Cancelar
              </button>
              {pendingCount > 0 && (
                <button
                  type="button"
                  onClick={() => setStep("export")}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                >
                  Exportar pendências
                </button>
              )}
              <button
                type="button"
                onClick={() => void handleSignOut(false)}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
              >
                Sair sem limpar dados
              </button>
              <button
                type="button"
                onClick={() => void handleSignOut(true)}
                className="rounded-md bg-status-error px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
              >
                Sair e limpar dispositivo
              </button>
            </div>
          )}
        </div>
      </dialog>
    </>
  );
}
