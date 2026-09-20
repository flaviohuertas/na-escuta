import type { AppDatabase } from "@/lib/db/dexie/schema";

/**
 * O que dizer à pessoa quando o servidor recusa o acesso a um evento. O motivo chega como um
 * código (`RejectionReason`); mostrá-lo cru ("EVENT_ACCESS_REVOKED") não ajuda ninguém.
 */
export function describeAccessRevoked(reason?: string | null): string {
  switch (reason) {
    case "MEMBERSHIP_REVOKED":
      return "Seu vínculo com a empresa foi encerrado, ou a sua conta foi desativada.";
    case "EVENT_ACCESS_REVOKED":
      return "Seu acesso a este evento foi retirado.";
    case "ENTITY_NOT_FOUND":
      return "Este evento não existe mais.";
    default:
      return "Seu acesso a este evento foi encerrado.";
  }
}

/**
 * O que, do evento, só existe NESTE aparelho — e por isso não pode ser apagado sem a pessoa decidir.
 */
export interface KeptOnDevice {
  /** Alterações que o servidor ainda não recebeu (a outbox do evento, em qualquer estado). */
  unsentChanges: number;
  /** Fotos/arquivos de evidência cujo binário só existe aqui (o binário nunca sobe ao servidor). */
  localFiles: number;
}

const NOTHING_KEPT: KeptOnDevice = { unsentChanges: 0, localFiles: 0 };

/**
 * Tira da fila de envio as operações ainda não enviadas (`PENDING`/`SENDING`), sem apagá-las:
 * viram `FAILED` com o motivo. Sem isto, quem abrisse o app depois neste aparelho — outra pessoa,
 * numa sessão dela — enviaria o trabalho de quem perdeu o acesso com a identidade errada.
 */
export async function quarantineOutbox(db: AppDatabase, eventId: string | null, reason: string | null): Promise<void> {
  const ops = eventId ? db.outbox.where("eventId").equals(eventId) : db.outbox.toCollection();
  await ops
    .and((op) => op.status === "PENDING" || op.status === "SENDING")
    .modify({ status: "FAILED", lastError: reason ?? "ACCESS_REVOKED" });
}

/** Os ids das evidências do evento cujo binário está guardado neste aparelho. */
async function evidenceIdsWithLocalFile(db: AppDatabase, eventId: string): Promise<string[]> {
  const ids = (await db.occurrenceEvidence.where("eventId").equals(eventId).primaryKeys()) as string[];
  const blobs = await db.evidenceBlobs.bulkGet(ids);
  return blobs.flatMap((blob) => (blob ? [blob.id] : []));
}

/** Quanto do evento ainda está no aparelho só porque não existe em outro lugar. Serve à tela. */
export async function countKeptOnDevice(db: AppDatabase, eventId: string): Promise<KeptOnDevice> {
  return {
    unsentChanges: await db.outbox.where("eventId").equals(eventId).count(),
    localFiles: (await evidenceIdsWithLocalFile(db, eventId)).length,
  };
}

/**
 * O servidor recusou o acesso a este evento: tira do aparelho o que o servidor já tem.
 *
 * Sai, sem perguntar — está guardado no servidor, não se perde nada: o evento, tarefas, checklists,
 * itens, ocorrências, os metadados de evidência sem arquivo local e os conflitos (a versão da pessoa
 * continua na outbox). Fica, em quarentena, o que só existe AQUI: as alterações ainda não enviadas
 * (a outbox do evento) e os arquivos de evidência (o binário nunca sobe ao servidor). Apagar isso
 * sem a pessoa saber destruiria trabalho de campo e evidência da empresa; quem decide é ela, na
 * tela do evento (`discardRevokedEventData`).
 *
 * Deixa o registro de sincronização com o aviso e SEM `lastFullBootstrapAt`: o evento deixa de ser
 * "preparado" (o ciclo de sync para de bater nele) e a tela sabe explicar o que houve. O aviso some
 * sozinho se a pessoa preparar o evento de novo depois de recuperar o acesso.
 *
 * Só age em evento que o aparelho conhece (não cria registro fantasma) e mexe SÓ nesse evento.
 * Tudo numa transação: ou o evento sai inteiro, ou nada muda.
 */
export async function purgeRevokedEventData(
  db: AppDatabase,
  eventId: string,
  reason: string | null
): Promise<KeptOnDevice> {
  return db.transaction(
    "rw",
    [
      db.events,
      db.tasks,
      db.checklists,
      db.checklistItems,
      db.occurrences,
      db.occurrenceEvidence,
      db.evidenceBlobs,
      db.conflicts,
      db.syncState,
      db.outbox,
    ],
    async () => {
      const state = await db.syncState.get(eventId);
      if (!state) return NOTHING_KEPT;

      await db.events.delete(eventId);
      await db.tasks.where("eventId").equals(eventId).delete();
      await db.checklists.where("eventId").equals(eventId).delete();
      await db.checklistItems.where("eventId").equals(eventId).delete();
      await db.occurrences.where("eventId").equals(eventId).delete();
      await db.conflicts.filter((conflict) => conflict.eventId === eventId).delete();

      // Evidência: sai o metadado de quem NÃO tem arquivo aqui; quem tem fica junto do arquivo.
      const withFile = new Set(await evidenceIdsWithLocalFile(db, eventId));
      const evidenceIds = (await db.occurrenceEvidence.where("eventId").equals(eventId).primaryKeys()) as string[];
      await db.occurrenceEvidence.bulkDelete(evidenceIds.filter((id) => !withFile.has(id)));

      // Quarentena: o que ainda está na fila NÃO pode ser enviado por outra sessão que abra depois
      // neste aparelho (a outbox não tem dono). Vira `FAILED`: só sai por exportação ou descarte.
      await quarantineOutbox(db, eventId, reason);

      await db.syncState.put({
        key: eventId,
        cursor: null,
        lastSyncAt: state.lastSyncAt,
        lastFullBootstrapAt: null,
        expectedCounts: null,
        accessRevokedAt: new Date().toISOString(),
        accessRevokedReason: reason,
      });

      return { unsentChanges: await db.outbox.where("eventId").equals(eventId).count(), localFiles: withFile.size };
    }
  );
}

/**
 * A pessoa decidiu tirar do aparelho TUDO o que sobrou de um evento cujo acesso foi retirado:
 * as alterações não enviadas, os arquivos de evidência e o próprio aviso. Não há como desfazer —
 * a tela só chama isto depois de uma confirmação que diz o que será apagado.
 *
 * Recusa evento cujo acesso NÃO foi retirado: descartar a outbox de um evento saudável perderia
 * trabalho que ainda vai ser enviado, e nenhuma tela deve chegar aqui por engano.
 */
export async function discardRevokedEventData(db: AppDatabase, eventId: string): Promise<void> {
  await db.transaction(
    "rw",
    [db.events, db.occurrenceEvidence, db.evidenceBlobs, db.syncState, db.outbox],
    async () => {
      const state = await db.syncState.get(eventId);
      if (!state?.accessRevokedAt) {
        throw new Error("O acesso a este evento não foi retirado: nada a descartar.");
      }

      await db.outbox.where("eventId").equals(eventId).delete();
      const evidenceIds = (await db.occurrenceEvidence.where("eventId").equals(eventId).primaryKeys()) as string[];
      await db.evidenceBlobs.bulkDelete(evidenceIds);
      await db.occurrenceEvidence.bulkDelete(evidenceIds);
      await db.events.delete(eventId);
      await db.syncState.delete(eventId);
    }
  );
}
