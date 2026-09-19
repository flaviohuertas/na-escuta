import type { AppDatabase, LocalConflict } from "@/lib/db/dexie/schema";
import { tableForEntity } from "./engine";

/**
 * Fecha um conflito NO DISPOSITIVO depois que o servidor confirmou a resolução (ou informou
 * que ela já tinha sido feita em outro dispositivo): a cópia local converge para a entidade
 * que o servidor devolveu, a operação `CONFLICT` sai da outbox e o registro do conflito vira
 * `RESOLVED`.
 *
 * Por que converge aqui em vez de esperar o pull: com "Manter o servidor" a entidade do
 * servidor não muda (mesma versão), então o pull nunca a traz de volta e a cópia local ficava
 * para sempre com os valores descartados e o selo "conflito".
 *
 * `serverEntity` nulo (resposta sem entidade): só limpa os marcadores, sem mexer nos dados.
 */
export async function applyConflictResolution(
  db: AppDatabase,
  conflict: LocalConflict,
  serverEntity: Record<string, unknown> | null
): Promise<void> {
  await db.transaction(
    "rw",
    [
      db.tasks,
      db.checklists,
      db.checklistItems,
      db.occurrences,
      db.occurrenceEvidence,
      db.outbox,
      db.conflicts,
    ],
    async () => {
      await db.outbox.delete(conflict.operationId);

      if (serverEntity) {
        // Se a pessoa continuou editando a mesma entidade depois do conflito, essas edições
        // seguem na outbox e serão enviadas sobre a versão resolvida: não as atropela. O mesmo
        // vale para OUTRO conflito ainda aberto na entidade (`CONFLICT`): a cópia local carrega o
        // valor dele, que a pessoa ainda não decidiu — mesma regra do pull (`applyPullResponse`).
        const remaining = await db.outbox.where("entityId").equals(conflict.entityId).toArray();
        const hasUnsettledLocalEdits = remaining.some(
          (op) => op.status === "PENDING" || op.status === "SENDING" || op.status === "CONFLICT"
        );
        if (!hasUnsettledLocalEdits) {
          const table = tableForEntity(db, conflict.entityType);
          await table.put({
            ...serverEntity,
            id: conflict.entityId,
            syncStatus: "synced",
          } as never);
        }
      }

      await db.conflicts.update(conflict.id, {
        status: "RESOLVED",
        resolvedAt: new Date().toISOString(),
      });
    }
  );
}
