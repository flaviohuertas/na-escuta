import type { AppDatabase, OutboxEntityType, OutboxOperation, OutboxOperationType } from "@/lib/db/dexie/schema";
import { generateOperationId } from "./ids";

export interface EnqueueParams {
  companyId: string;
  eventId: string;
  entityType: OutboxEntityType;
  entityId: string;
  operationType: OutboxOperationType;
  payload: Record<string, unknown>;
  /** Versão local conhecida da entidade. Só é `null` em CREATE. */
  currentVersion: number | null;
  deviceId: string;
}

export type EnqueueResult =
  | { kind: "queued"; operation: OutboxOperation }
  | { kind: "cancelled-create" };

/**
 * Enfileira uma operação na outbox, DEVE ser chamado dentro de uma transação
 * Dexie `rw` já aberta que inclua `db.outbox` (e a tabela da entidade), para
 * que gravação local e enfileiramento sejam atômicos (requisito: nunca pode
 * existir entidade gravada sem outbox correspondente, nem outbox sem a
 * gravação local).
 *
 * Se já existe uma operação PENDING (ainda não enviada) para a mesma
 * entidade, a nova mudança é mesclada nela (coalescing) em vez de criar uma
 * segunda operação — isso evita "auto-conflitos" quando o mesmo dispositivo
 * edita a mesma entidade várias vezes antes de sincronizar: o baseVersion
 * original (a versão do servidor antes de qualquer edição local pendente) é
 * preservado. Operações já em SENDING não são mescladas (estão potencialmente
 * em trânsito); o motor de sync garante que só há uma operação em SENDING por
 * entidade por vez, processando a fila em ordem por entidade.
 *
 * Caso especial: um CREATE ainda pendente seguido de um DELETE local (o
 * registro nunca chegou a existir no servidor) cancela a operação — não há
 * nada para sincronizar, e o chamador deve apagar fisicamente o registro
 * local (não apenas marcar tombstone).
 */
export async function enqueueOperation(
  db: AppDatabase,
  params: EnqueueParams
): Promise<EnqueueResult> {
  const existingPending = await db.outbox
    .where("[entityType+entityId]")
    .equals([params.entityType, params.entityId])
    .filter((op) => op.status === "PENDING")
    .first();

  const now = new Date().toISOString();

  if (existingPending) {
    if (existingPending.operationType === "CREATE" && params.operationType === "DELETE") {
      await db.outbox.delete(existingPending.id);
      return { kind: "cancelled-create" };
    }

    const merged: OutboxOperation = {
      ...existingPending,
      operationType:
        existingPending.operationType === "CREATE" ? "CREATE" : params.operationType,
      payload:
        params.operationType === "DELETE"
          ? params.payload
          : { ...existingPending.payload, ...params.payload },
    };
    await db.outbox.put(merged);
    return { kind: "queued", operation: merged };
  }

  const operation: OutboxOperation = {
    id: generateOperationId(),
    companyId: params.companyId,
    eventId: params.eventId,
    entityType: params.entityType,
    entityId: params.entityId,
    operationType: params.operationType,
    payload: params.payload,
    baseVersion: params.currentVersion,
    status: "PENDING",
    attempts: 0,
    lastAttemptAt: null,
    nextAttemptAt: now,
    lastError: null,
    createdAt: now,
    deviceId: params.deviceId,
  };
  await db.outbox.add(operation);
  return { kind: "queued", operation };
}

/** Backoff exponencial com teto e jitter: 2s, 4s, 8s, 16s, 32s, 60s (teto), ±20% jitter. */
export function computeBackoffDelayMs(attempts: number): number {
  const base = Math.min(60_000, 2_000 * 2 ** Math.max(0, attempts - 1));
  const jitter = base * 0.2 * (Math.random() * 2 - 1);
  return Math.round(base + jitter);
}

export async function countPendingOperations(db: AppDatabase, eventId?: string): Promise<number> {
  const collection = eventId
    ? db.outbox.where("eventId").equals(eventId)
    : db.outbox.toCollection();
  return collection.filter((op) => op.status === "PENDING" || op.status === "FAILED").count();
}

/**
 * Ao reabrir o app, qualquer operação presa em SENDING está em estado
 * ambíguo (pode ou não ter chegado ao servidor antes do app fechar) — volta
 * para PENDING para ser reenviada. A idempotência no servidor (PK =
 * operationId) garante que isso nunca duplica o efeito.
 */
export async function recoverIncompleteOperations(db: AppDatabase): Promise<number> {
  const stuck = await db.outbox.where("status").equals("SENDING").toArray();
  if (stuck.length === 0) return 0;
  await db.transaction("rw", db.outbox, async () => {
    for (const op of stuck) {
      await db.outbox.update(op.id, { status: "PENDING", nextAttemptAt: new Date().toISOString() });
    }
  });
  return stuck.length;
}
