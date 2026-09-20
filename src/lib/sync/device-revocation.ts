import type { AppDatabase } from "@/lib/db/dexie/schema";
import { quarantineOutbox, type KeptOnDevice } from "./access";

/**
 * O que descrever à pessoa quando o servidor diz que ESTE APARELHO perdeu o acesso. O motivo chega
 * como código (`DeviceRevokedReason`); mostrá-lo cru não ajuda ninguém.
 */
export function describeDeviceRevoked(reason?: string | null): string {
  switch (reason) {
    case "ACCOUNT_DISABLED":
      return "A sua conta foi desativada.";
    case "DEVICE_REVOKED":
      return "O acesso deste aparelho foi encerrado.";
    case "MEMBERSHIP_REVOKED":
      return "Seu vínculo com a empresa foi encerrado.";
    default:
      return "Este aparelho perdeu o acesso à empresa.";
  }
}

/**
 * A pessoa decidiu tirar do aparelho TUDO o que sobrou, inclusive o aviso. Não há como desfazer —
 * a tela só chama isto depois de uma confirmação que diz o que será apagado.
 *
 * RECUSA um aparelho que não foi revogado: esvaziar o banco de um aparelho saudável perderia
 * trabalho que ainda vai ser enviado, e nenhuma tela deve chegar aqui por engano. Esvazia as
 * tabelas em vez de apagar o banco: as telas abertas seguem consultando um banco aberto, sem erro
 * no meio da navegação para fora.
 */
export async function discardRevokedDeviceData(db: AppDatabase): Promise<void> {
  await db.transaction("rw", db.tables, async () => {
    if (!(await db.deviceState.get("revocation"))) {
      throw new Error("Este aparelho não foi revogado: nada a descartar.");
    }
    for (const table of db.tables) await table.clear();
  });
}

/** Quanto ainda está no aparelho só porque não existe em outro lugar (todos os eventos). */
export async function countKeptOnDeviceAll(db: AppDatabase): Promise<KeptOnDevice> {
  return { unsentChanges: await db.outbox.count(), localFiles: await db.evidenceBlobs.count() };
}

/**
 * O servidor disse que ESTE APARELHO perdeu o acesso: tira dele TUDO o que o servidor já guarda —
 * de todos os eventos — e apaga o grant offline (sem ele o aparelho não pergunta mais nada).
 *
 * É a versão do aparelho inteiro de `purgeRevokedEventData`, com a mesma regra: sai sem perguntar
 * o que existe no servidor; fica em quarentena o que só existe AQUI (alterações não enviadas e
 * arquivos de evidência, cujo binário nunca sobe), até a pessoa exportar ou remover. Deixa o
 * aviso (`deviceState`) para a tela explicar o que houve.
 *
 * `onlyIfGrant`: só age se o grant guardado ainda é o que foi julgado. Se, entre perguntar e
 * limpar, a pessoa entrou de novo (o vínculo voltou) e um grant novo foi guardado, o veredito é
 * velho — e apagar seria destruir os dados de quem acabou de recuperar o acesso. Devolve `null`
 * quando desiste. Tudo numa transação: ou o aparelho é limpo inteiro, ou nada muda.
 */
export async function purgeDeviceData(
  db: AppDatabase,
  params: { reason: string | null; userId: string | null; onlyIfGrant?: string }
): Promise<KeptOnDevice | null> {
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
      db.session,
      db.deviceState,
    ],
    async () => {
      if (params.onlyIfGrant !== undefined) {
        const current = await db.session.get("current");
        if (current?.jwt !== params.onlyIfGrant) return null;
      }

      await db.events.clear();
      await db.tasks.clear();
      await db.checklists.clear();
      await db.checklistItems.clear();
      await db.occurrences.clear();
      await db.conflicts.clear();
      await db.syncState.clear();

      // Evidência: sai o metadado de quem NÃO tem arquivo aqui; quem tem fica junto do arquivo.
      const withFile = new Set((await db.evidenceBlobs.toCollection().primaryKeys()) as string[]);
      const evidenceIds = (await db.occurrenceEvidence.toCollection().primaryKeys()) as string[];
      await db.occurrenceEvidence.bulkDelete(evidenceIds.filter((id) => !withFile.has(id)));

      // Quarentena: ninguém envia o que sobrou com a identidade de outra pessoa (a outbox não tem dono).
      await quarantineOutbox(db, null, params.reason);

      await db.session.delete("current");
      await db.deviceState.put({
        key: "revocation",
        revokedAt: new Date().toISOString(),
        reason: params.reason,
        userId: params.userId,
      });

      return countKeptOnDeviceAll(db);
    }
  );
}
