"use client";

import { RevokedDataPanel } from "@/components/sync/RevokedDataPanel";
import { getDb } from "@/lib/db/dexie/db";
import { countKeptOnDevice, describeAccessRevoked, discardRevokedEventData } from "@/lib/sync/access";
import { exportPendingChangesEncrypted } from "@/lib/sync/export-pending";
import { navigateToDocument } from "@/lib/offline/navigate";

/**
 * A tela de um evento cujo acesso foi retirado. O aparelho já tirou de si o que o servidor guarda
 * DESTE evento (`purgeRevokedEventData`); ver `RevokedDataPanel` para o que a pessoa pode fazer
 * com o que sobrou.
 */
export function RevokedEventPanel({ eventId, reason }: { eventId: string; reason: string | null }) {
  return (
    <RevokedDataPanel
      title={describeAccessRevoked(reason)}
      intro="Os dados deste evento que já estão guardados no servidor foram removidos deste aparelho."
      footer="Se isso for um engano, fale com quem gerencia o evento. Quando o acesso voltar, prepare o evento de novo abaixo."
      scopeKey={eventId}
      loadKept={() => countKeptOnDevice(getDb(), eventId)}
      exportChanges={(passphrase) => exportPendingChangesEncrypted(getDb(), passphrase, { eventId })}
      discard={() => discardRevokedEventData(getDb(), eventId)}
      afterDiscard={() => navigateToDocument("/eventos")}
    />
  );
}
