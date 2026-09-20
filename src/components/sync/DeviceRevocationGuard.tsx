"use client";

import { useEffect } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { RevokedDataPanel } from "@/components/sync/RevokedDataPanel";
import { checkDeviceStatus } from "@/lib/auth/device-check";
import { getDb } from "@/lib/db/dexie/db";
import { navigateToDocument } from "@/lib/offline/navigate";
import { countKeptOnDeviceAll, describeDeviceRevoked, discardRevokedDeviceData } from "@/lib/sync/device-revocation";
import { exportPendingChangesEncrypted } from "@/lib/sync/export-pending";

/** Não pergunta de novo antes disto (várias abas, foco e conexão oscilando disparam vários gatilhos). */
const MIN_INTERVAL_MS = 30_000;
/** Com a página aberta o tempo todo, uma pergunta a cada tanto. */
const POLL_INTERVAL_MS = 5 * 60_000;

/**
 * Fica no layout RAIZ — presente em todas as páginas, inclusive `/login`, que é onde cai quem teve
 * o vínculo encerrado (a sessão dele já não existe, então nenhuma tela do app abre).
 *
 * Faz duas coisas: (1) pergunta ao servidor, sem sessão, se este aparelho ainda vale
 * (`checkDeviceStatus`) ao abrir, ao voltar a conexão, ao voltar o foco e de tempos em tempos; se
 * o servidor diz que não, o aparelho se limpa. (2) Mostra o aviso do que houve e do que sobrou.
 */
export function DeviceRevocationGuard() {
  const revocation = useLiveQuery(async () => (await getDb().deviceState.get("revocation")) ?? null, [], null);

  useEffect(() => {
    let lastRunAt = 0;
    const run = () => {
      if (navigator.onLine === false) return;
      const now = Date.now();
      if (now - lastRunAt < MIN_INTERVAL_MS) return;
      lastRunAt = now;
      // Um erro aqui nunca pode derrubar a página: sem resposta, o aparelho fica como está.
      void checkDeviceStatus(getDb()).catch(() => undefined);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") run();
    };

    run();
    window.addEventListener("online", run);
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(run, POLL_INTERVAL_MS);
    return () => {
      window.removeEventListener("online", run);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, []);

  if (!revocation) return null;

  return (
    <div className="mx-auto w-full max-w-3xl px-4">
      <RevokedDataPanel
        title={describeDeviceRevoked(revocation.reason)}
        intro="Os dados da empresa que estavam guardados neste aparelho foram removidos."
        footer="Se isso for um engano, fale com quem administra a sua empresa. Quando o acesso voltar, entre de novo."
        scopeKey={revocation.revokedAt}
        loadKept={() => countKeptOnDeviceAll(getDb())}
        exportChanges={(passphrase) => exportPendingChangesEncrypted(getDb(), passphrase)}
        discard={() => discardRevokedDeviceData(getDb())}
        afterDiscard={() => navigateToDocument("/login")}
      />
    </div>
  );
}
