"use client";

import { useId, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type { KeptOnDevice } from "@/lib/sync/access";
import { downloadEncryptedExport } from "@/lib/sync/export-download";
import type { EncryptedExport } from "@/lib/sync/export-pending";
import { buttonClass } from "@/components/ui/Button";

type Step = "idle" | "export" | "exporting" | "confirm-discard" | "discarding";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export interface RevokedDataPanelProps {
  /** O motivo, em palavras (nunca o código). */
  title: string;
  /** O que já foi tirado do aparelho. */
  intro: string;
  /** O que fazer se for engano. */
  footer: string;
  /** Muda quando a consulta de "o que sobrou" precisa ser refeita (o evento, ou o aparelho todo). */
  scopeKey: string;
  loadKept: () => Promise<KeptOnDevice>;
  exportChanges: (passphrase: string) => Promise<EncryptedExport>;
  discard: () => Promise<void>;
  /** Depois de remover: sai da tela, que deixou de fazer sentido. */
  afterDiscard: () => void;
}

/**
 * O que a pessoa vê quando o aparelho perdeu o acesso (a um evento, ou a tudo). O aparelho já
 * tirou de si o que o servidor guarda; aqui ela vê o que SOBROU — o que só existe neste aparelho
 * — e decide: exportar as alterações (arquivo cifrado) e/ou remover tudo. Nada é apagado sem uma
 * confirmação que diz o que se perde.
 */
export function RevokedDataPanel(props: RevokedDataPanelProps) {
  const { title, intro, footer, scopeKey, loadKept, exportChanges, discard, afterDiscard } = props;
  const passphraseId = useId();
  const [step, setStep] = useState<Step>("idle");
  const [passphrase, setPassphrase] = useState("");
  const [exportedFileName, setExportedFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // `undefined` enquanto a consulta carrega: não afirma "não ficou nada" antes de saber.
  // `loadKept` é uma closure nova a cada render; quem manda refazer a consulta é `scopeKey`.
  const kept = useLiveQuery(() => loadKept(), [scopeKey]);

  async function handleExport() {
    if (passphrase.trim().length < 8) {
      setError("Use uma senha de exportação com pelo menos 8 caracteres.");
      return;
    }
    setStep("exporting");
    setError(null);
    try {
      setExportedFileName(downloadEncryptedExport(await exportChanges(passphrase)));
      setPassphrase("");
      setStep("idle");
    } catch {
      setError("Não foi possível exportar as alterações não enviadas.");
      setStep("export");
    }
  }

  async function handleDiscard() {
    setStep("discarding");
    setError(null);
    try {
      await discard();
      afterDiscard();
    } catch {
      setError("Não foi possível remover os dados deste aparelho. Tente de novo.");
      setStep("confirm-discard");
    }
  }

  const hasKept = kept ? kept.unsentChanges > 0 || kept.localFiles > 0 : false;
  const keptSummary = kept
    ? [
        kept.unsentChanges > 0 && plural(kept.unsentChanges, "alteração", "alterações"),
        kept.localFiles > 0 && plural(kept.localFiles, "arquivo", "arquivos"),
      ]
        .filter(Boolean)
        .join(" e ")
    : "";
  const busy = step === "exporting" || step === "discarding";

  return (
    <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
      <p className="font-medium">{title}</p>
      <p className="mt-1">{intro}</p>

      {kept === undefined ? null : hasKept ? (
        <div className="mt-3">
          <p>Ficou aqui só o que ainda não chegou ao servidor, e isso não será enviado, porque o acesso foi retirado:</p>
          <ul className="mt-1 list-disc pl-5">
            {kept.unsentChanges > 0 && (
              <li>
                <strong>{plural(kept.unsentChanges, "alteração não enviada", "alterações não enviadas")}</strong>
              </li>
            )}
            {kept.localFiles > 0 && (
              <li>
                <strong>{plural(kept.localFiles, "arquivo", "arquivos")}</strong> (fotos, documentos) que só{" "}
                {kept.localFiles === 1 ? "existe" : "existem"} neste aparelho
              </li>
            )}
          </ul>
        </div>
      ) : (
        <p className="mt-3">Não ficou nada que exista só neste aparelho.</p>
      )}

      {error && (
        <p className="mt-3 font-medium" data-testid="revoked-error">
          {error}
        </p>
      )}
      {exportedFileName && <p className="mt-3">Exportado: {exportedFileName}</p>}

      {step === "export" || step === "exporting" ? (
        <div className="mt-3 space-y-2">
          <label htmlFor={passphraseId} className="block font-medium">
            Senha para proteger o arquivo exportado
          </label>
          <input
            id={passphraseId}
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900"
            autoFocus
          />
          <p className="text-xs">O arquivo leva só as alterações, não as fotos e arquivos.</p>
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => void handleExport()}
              disabled={busy}
              className={buttonClass({ size: "sm" })}
            >
              {step === "exporting" ? "Exportando…" : "Exportar arquivo cifrado"}
            </button>
            <button
              type="button"
              onClick={() => setStep("idle")}
              disabled={busy}
              className={buttonClass({ variant: "secondary", size: "sm" })}
            >
              Voltar
            </button>
          </div>
        </div>
      ) : step === "confirm-discard" || step === "discarding" ? (
        <div className="mt-3 rounded-lg bg-white p-3 text-slate-900">
          <p>
            {hasKept ? (
              <>
                Remover apaga <strong>agora e para sempre</strong> o que ficou neste aparelho ({keptSummary}): nada
                disso existe em outro lugar. Não dá para desfazer. Exporte antes se quiser guardar as alterações.
              </>
            ) : (
              <>Isso só tira este aviso do aparelho.</>
            )}
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => void handleDiscard()}
              disabled={busy}
              className={buttonClass({ variant: "danger", size: "sm" })}
            >
              {step === "discarding" ? "Removendo…" : hasKept ? "Sim, remover do aparelho" : "Dispensar aviso"}
            </button>
            <button
              type="button"
              onClick={() => setStep("idle")}
              disabled={busy}
              className={buttonClass({ variant: "secondary", size: "sm" })}
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        kept !== undefined && (
          <div className="mt-3 flex flex-wrap gap-2">
            {kept.unsentChanges > 0 && (
              <button
                type="button"
                onClick={() => setStep("export")}
                className={buttonClass({ variant: "ghost-danger", size: "sm" })}
              >
                Exportar alterações não enviadas
              </button>
            )}
            <button
              type="button"
              onClick={() => (hasKept ? setStep("confirm-discard") : void handleDiscard())}
              className={buttonClass({ variant: "ghost-danger", size: "sm" })}
            >
              {hasKept ? "Remover do aparelho" : "Dispensar aviso"}
            </button>
          </div>
        )
      )}

      <p className="mt-3 text-xs">{footer}</p>
    </div>
  );
}
