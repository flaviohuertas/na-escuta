import type { AppDatabase } from "@/lib/db/dexie/schema";
import { clearEventRoutesCache } from "@/lib/offline/warm-routes";
import { purgeRevokedEventData } from "./access";
import { listPreparedEventIds } from "./bootstrap";
import { AccessRevokedError, runFullSyncCycleLocked } from "./engine";

/**
 * Um ciclo de sincronização de TODOS os eventos preparados neste aparelho.
 *
 * O acesso a UM evento pode ter sido retirado (o servidor responde "acesso revogado"). Isso não
 * pode impedir os outros: antes, o erro abortava o laço inteiro, e como o evento revogado seguia
 * na lista, nenhum evento do aparelho voltava a sincronizar. Agora o evento revogado sai do
 * aparelho (só fica o que não existe em outro lugar — ver `purgeRevokedEventData`), a tela dele
 * explica o que houve e o ciclo segue. Qualquer outro erro (rede, servidor) continua abortando.
 */
export async function syncAllPreparedEvents(
  db: AppDatabase,
  ctx: { deviceId: string; fetchImpl?: typeof fetch }
): Promise<{ revokedEventIds: string[] }> {
  const revokedEventIds: string[] = [];

  for (const eventId of await listPreparedEventIds(db)) {
    try {
      const result = await runFullSyncCycleLocked(db, { eventId, ...ctx });
      if (result === "skipped-locked") break;
    } catch (err) {
      if (!(err instanceof AccessRevokedError)) throw err;
      await purgeRevokedEventData(db, eventId, err.reason);
      await clearEventRoutesCache(eventId);
      revokedEventIds.push(eventId);
    }
  }

  return { revokedEventIds };
}
