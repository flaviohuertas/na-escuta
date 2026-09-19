import type { AppDatabase, OutboxEntityType, OutboxOperation } from "@/lib/db/dexie/schema";
import {
  PullResponseSchema,
  PushResponseSchema,
  type PullResponse,
  type PushRequest,
  type PushResponse,
} from "./protocol";
import { computeBackoffDelayMs, recoverIncompleteOperations } from "./outbox";

export class AccessRevokedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccessRevokedError";
  }
}

export function tableForEntity(db: AppDatabase, entityType: OutboxEntityType) {
  switch (entityType) {
    case "Task":
      return db.tasks;
    case "ChecklistTemplate":
      return db.checklists;
    case "ChecklistItem":
      return db.checklistItems;
    case "Occurrence":
      return db.occurrences;
    case "OccurrenceEvidence":
      return db.occurrenceEvidence;
  }
}

const MAX_PUSH_BATCH_SIZE = 50;

// ---------------------------------------------------------------------------
// Aplicação de respostas do servidor (sempre dentro de transação Dexie)
// ---------------------------------------------------------------------------

export async function applyPullResponse(
  db: AppDatabase,
  eventId: string,
  response: PullResponse
): Promise<void> {
  const parsed = PullResponseSchema.parse(response);

  await db.transaction(
    "rw",
    [
      db.tasks,
      db.checklists,
      db.checklistItems,
      db.occurrences,
      db.occurrenceEvidence,
      db.syncState,
      db.outbox,
      db.conflicts,
    ],
    async () => {
      for (const change of parsed.changes) {
        const localOps = await db.outbox.where("entityId").equals(change.entityId).toArray();
        // Nunca sobrescreve uma entidade com edição local que o servidor ainda não aceitou:
        //  - PENDING/SENDING: o próximo push reconcilia (ou gera conflito visível);
        //  - CONFLICT: o servidor JÁ recusou essa edição e a pessoa ainda não decidiu. O pull do
        //    mesmo ciclo traz justamente a versão do servidor que causou o conflito — sobrescrever
        //    aqui (e dar o conflito por "superado") apagava a edição offline em silêncio, sem a
        //    pessoa nunca ver a tela de conflitos. Só a resolução explícita
        //    (`applyConflictResolution`) fecha um conflito.
        const hasUnsettledLocalEdit = localOps.some(
          (op) => op.status === "PENDING" || op.status === "SENDING" || op.status === "CONFLICT"
        );
        if (hasUnsettledLocalEdit) continue;

        const table = tableForEntity(db, change.entityType);
        if (change.deletedAt || !change.data) {
          await table.delete(change.entityId);
          continue;
        }
        await table.put({
          ...(change.data as Record<string, unknown>),
          id: change.entityId,
          version: change.version,
          updatedAt: change.updatedAt,
          syncStatus: "synced",
        } as never);
      }

      const currentCursor = await db.syncState.get(eventId);
      await db.syncState.put({
        key: eventId,
        cursor: parsed.nextCursor,
        lastSyncAt: new Date().toISOString(),
        lastFullBootstrapAt: currentCursor?.lastFullBootstrapAt ?? null,
        expectedCounts: currentCursor?.expectedCounts ?? null,
      });
    }
  );
}

export async function applyPushResponse(db: AppDatabase, response: PushResponse): Promise<void> {
  const parsed = PushResponseSchema.parse(response);

  await db.transaction(
    "rw",
    [db.outbox, db.tasks, db.checklists, db.checklistItems, db.occurrences, db.occurrenceEvidence, db.conflicts],
    async () => {
      for (const result of parsed.results) {
        const op = await db.outbox.get(result.operationId);
        if (!op) continue; // já processado anteriormente (reenvio idempotente)

        const table = tableForEntity(db, op.entityType);

        if (result.outcome === "APPLIED" || result.outcome === "DUPLICATE_IGNORED") {
          await db.outbox.delete(op.id);
          const exists = await table.get(op.entityId);
          if (exists) {
            await table.update(op.entityId, {
              syncStatus: "synced",
              ...(result.serverVersion ? { version: result.serverVersion } : {}),
            } as never);
          }
          continue;
        }

        if (result.outcome === "CONFLICT") {
          await db.outbox.update(op.id, { status: "CONFLICT" });
          await db.conflicts.put({
            id: result.conflictId ?? op.id,
            entityType: op.entityType,
            entityId: op.entityId,
            eventId: op.eventId,
            baseVersion: op.baseVersion ?? 0,
            serverVersion: result.serverVersion ?? 0,
            clientPayload: op.payload,
            serverPayload: (result.serverEntity as Record<string, unknown>) ?? {},
            operationId: op.id,
            status: "PENDING",
            detectedAt: new Date().toISOString(),
            resolvedAt: null,
          });
          const exists = await table.get(op.entityId);
          if (exists) await table.update(op.entityId, { syncStatus: "conflict" } as never);
          continue;
        }

        // REJECTED
        await db.outbox.update(op.id, {
          status: "FAILED",
          lastError: result.rejectionReason ?? "Rejeitado pelo servidor",
        });
        const exists = await table.get(op.entityId);
        if (exists) await table.update(op.entityId, { syncStatus: "error" } as never);
      }
    }
  );
}

async function resetStuckSendingToPending(db: AppDatabase, ids: string[], error: string): Promise<void> {
  if (ids.length === 0) return;
  await db.transaction("rw", db.outbox, async () => {
    for (const id of ids) {
      const fresh = await db.outbox.get(id);
      if (!fresh || fresh.status !== "SENDING") continue;
      await db.outbox.update(id, {
        status: "PENDING",
        lastError: error,
        nextAttemptAt: new Date(Date.now() + computeBackoffDelayMs(fresh.attempts)).toISOString(),
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Push / Pull contra a rede
// ---------------------------------------------------------------------------

export interface EngineContext {
  eventId: string;
  deviceId: string;
  fetchImpl?: typeof fetch;
}

export async function pushPendingOperations(
  db: AppDatabase,
  ctx: { deviceId: string; fetchImpl?: typeof fetch }
): Promise<{ sent: number }> {
  const fetchImpl = ctx.fetchImpl ?? fetch;
  const now = new Date().toISOString();

  const eligible = (
    await db.outbox.where("status").equals("PENDING").toArray()
  )
    .filter((op) => op.nextAttemptAt <= now)
    .slice(0, MAX_PUSH_BATCH_SIZE);

  if (eligible.length === 0) return { sent: 0 };

  await db.transaction("rw", db.outbox, async () => {
    for (const op of eligible) {
      await db.outbox.update(op.id, {
        status: "SENDING",
        lastAttemptAt: now,
        attempts: op.attempts + 1,
      });
    }
  });

  const request: PushRequest = {
    deviceId: ctx.deviceId,
    operations: eligible.map(
      (op): PushRequest["operations"][number] => ({
        id: op.id,
        companyId: op.companyId,
        eventId: op.eventId,
        entityType: op.entityType,
        entityId: op.entityId,
        operationType: op.operationType,
        baseVersion: op.baseVersion,
        payload: op.payload,
        clientTimestamp: op.lastAttemptAt ?? now,
        deviceId: op.deviceId,
      })
    ),
  };

  try {
    const res = await fetchImpl("/api/sync/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!res.ok) {
      throw new Error(`Falha ao sincronizar (status ${res.status})`);
    }
    const json = await res.json();
    const parsed = PushResponseSchema.parse(json);
    await applyPushResponse(db, parsed);

    // Resposta parcial: operações enviadas mas sem resultado correspondente
    // continuam "SENDING" — devolve pra fila com backoff em vez de ficar presa.
    await resetStuckSendingToPending(
      db,
      eligible.map((op) => op.id),
      "Servidor não retornou resultado para esta operação (resposta parcial)."
    );

    return { sent: eligible.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro desconhecido ao sincronizar";
    await resetStuckSendingToPending(db, eligible.map((op) => op.id), message);
    throw err;
  }
}

export async function pullChanges(
  db: AppDatabase,
  ctx: {
    eventId: string;
    fetchImpl?: typeof fetch;
    onPage?: (appliedInPage: number, totalSoFar: number) => void;
  }
): Promise<{ applied: number }> {
  const fetchImpl = ctx.fetchImpl ?? fetch;
  let applied = 0;
  let hasMore = true;

  while (hasMore) {
    const cursorRow = await db.syncState.get(ctx.eventId);
    const params = new URLSearchParams({ eventId: ctx.eventId });
    if (cursorRow?.cursor) params.set("cursor", cursorRow.cursor);

    const res = await fetchImpl(`/api/sync/pull?${params.toString()}`, {
      method: "GET",
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`Falha ao buscar mudanças (status ${res.status})`);
    }
    const json = await res.json();
    const parsed = PullResponseSchema.parse(json);

    if (parsed.accessRevoked) {
      throw new AccessRevokedError(
        parsed.revokedReason ?? "Seu acesso a este evento foi revogado."
      );
    }

    await applyPullResponse(db, ctx.eventId, parsed);
    applied += parsed.changes.length;
    hasMore = parsed.hasMore;
    ctx.onPage?.(parsed.changes.length, applied);
  }

  return { applied };
}

export async function runFullSyncCycle(
  db: AppDatabase,
  ctx: EngineContext
): Promise<{ pushed: number; pulled: number }> {
  await recoverIncompleteOperations(db);

  let pushed = 0;
  while (true) {
    const { sent } = await pushPendingOperations(db, ctx);
    pushed += sent;
    if (sent === 0) break;
  }

  const { applied } = await pullChanges(db, ctx);

  return { pushed, pulled: applied };
}

/**
 * Evita duas abas do mesmo dispositivo rodando o motor de sync ao mesmo
 * tempo (Web Locks API). Se a API não existir (navegador antigo) ou o lock
 * já estiver em uso por outra aba, roda direto / não roda de novo — nunca
 * bloqueia o chamador indefinidamente.
 */
export async function runFullSyncCycleLocked(
  db: AppDatabase,
  ctx: EngineContext
): Promise<{ pushed: number; pulled: number } | "skipped-locked"> {
  if (typeof navigator === "undefined" || !("locks" in navigator)) {
    return runFullSyncCycle(db, ctx);
  }

  const result = await navigator.locks.request(
    "na-escuta-sync-engine",
    { ifAvailable: true },
    async (lock) => {
      if (!lock) return "skipped-locked" as const;
      return runFullSyncCycle(db, ctx);
    }
  );
  return result;
}
