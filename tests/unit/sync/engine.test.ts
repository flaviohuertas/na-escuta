import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, resetDbInstanceForTests } from "@/lib/db/dexie/db";
import type { LocalTask, OutboxOperation } from "@/lib/db/dexie/schema";
import {
  AccessRevokedError,
  applyPullResponse,
  applyPushResponse,
  pullChanges,
  pushPendingOperations,
  runFullSyncCycle,
} from "@/lib/sync/engine";
import type { PullResponse, PushResponse } from "@/lib/sync/protocol";

const eventId = "01991b1a-0000-7000-8000-000000000010";
const companyId = "01991b1a-0000-7000-8000-000000000099";
const deviceId = "device-1";

function baseTask(overrides: Partial<LocalTask> = {}): LocalTask {
  const now = new Date().toISOString();
  return {
    id: "01991b1a-0000-7000-8000-000000000001",
    eventId,
    companyId,
    title: "Tarefa",
    description: null,
    status: "TODO",
    priority: 0,
    dueAt: null,
    assignedToUserId: null,
    version: 1,
    syncStatus: "synced",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    createdBy: null,
    updatedBy: null,
    ...overrides,
  };
}

function baseOp(overrides: Partial<OutboxOperation> = {}): OutboxOperation {
  const now = new Date().toISOString();
  return {
    id: "01991b1a-0000-7000-8000-0000000000a1",
    companyId,
    eventId,
    entityType: "Task",
    entityId: "01991b1a-0000-7000-8000-000000000001",
    operationType: "UPDATE",
    payload: { title: "Editado" },
    baseVersion: 1,
    status: "PENDING",
    attempts: 0,
    lastAttemptAt: null,
    nextAttemptAt: now,
    lastError: null,
    createdAt: now,
    deviceId,
    ...overrides,
  };
}

describe("sync engine", () => {
  beforeEach(() => resetDbInstanceForTests());
  afterEach(async () => {
    const db = getDb();
    db.close();
    await db.delete();
    resetDbInstanceForTests();
  });

  describe("applyPullResponse", () => {
    it("grava mudanças novas e avança o cursor", async () => {
      const db = getDb();
      const response: PullResponse = {
        changes: [
          {
            entityType: "Task",
            entityId: "01991b1a-0000-7000-8000-000000000001",
            version: 2,
            deletedAt: null,
            data: { ...baseTask(), version: 2 },
            updatedAt: new Date().toISOString(),
          },
        ],
        nextCursor: "cursor-1",
        hasMore: false,
        serverTime: new Date().toISOString(),
        accessRevoked: false,
      };

      await applyPullResponse(db, eventId, response);

      const task = await db.tasks.get("01991b1a-0000-7000-8000-000000000001");
      expect(task?.version).toBe(2);
      expect(task?.syncStatus).toBe("synced");

      const cursor = await db.syncState.get(eventId);
      expect(cursor?.cursor).toBe("cursor-1");
    });

    it("nunca sobrescreve uma entidade com edição local pendente", async () => {
      const db = getDb();
      await db.tasks.add(baseTask({ title: "Local não sincronizado", syncStatus: "pending" }));
      await db.outbox.add(baseOp());

      const response: PullResponse = {
        changes: [
          {
            entityType: "Task",
            entityId: "01991b1a-0000-7000-8000-000000000001",
            version: 5,
            deletedAt: null,
            data: { ...baseTask(), title: "Versão do servidor", version: 5 },
            updatedAt: new Date().toISOString(),
          },
        ],
        nextCursor: "cursor-2",
        hasMore: false,
        serverTime: new Date().toISOString(),
        accessRevoked: false,
      };

      await applyPullResponse(db, eventId, response);

      const task = await db.tasks.get("01991b1a-0000-7000-8000-000000000001");
      expect(task?.title).toBe("Local não sincronizado");
    });

    it("aplica tombstone removendo a entidade local", async () => {
      const db = getDb();
      await db.tasks.add(baseTask());

      const response: PullResponse = {
        changes: [
          {
            entityType: "Task",
            entityId: "01991b1a-0000-7000-8000-000000000001",
            version: 2,
            deletedAt: new Date().toISOString(),
            data: null,
            updatedAt: new Date().toISOString(),
          },
        ],
        nextCursor: "cursor-3",
        hasMore: false,
        serverTime: new Date().toISOString(),
        accessRevoked: false,
      };

      await applyPullResponse(db, eventId, response);
      const task = await db.tasks.get("01991b1a-0000-7000-8000-000000000001");
      expect(task).toBeUndefined();
    });
  });

  describe("applyPushResponse", () => {
    it("APPLIED remove a operação da outbox e atualiza a versão local", async () => {
      const db = getDb();
      await db.tasks.add(baseTask({ syncStatus: "syncing" }));
      await db.outbox.add(baseOp({ status: "SENDING" }));

      const response: PushResponse = {
        results: [
          {
            operationId: "01991b1a-0000-7000-8000-0000000000a1",
            entityId: "01991b1a-0000-7000-8000-000000000001",
            outcome: "APPLIED",
            serverVersion: 2,
          },
        ],
        serverTime: new Date().toISOString(),
      };

      await applyPushResponse(db, response);

      const op = await db.outbox.get("01991b1a-0000-7000-8000-0000000000a1");
      expect(op).toBeUndefined();
      const task = await db.tasks.get("01991b1a-0000-7000-8000-000000000001");
      expect(task?.version).toBe(2);
      expect(task?.syncStatus).toBe("synced");
    });

    it("DUPLICATE_IGNORED também limpa a outbox (reenvio idempotente não duplica)", async () => {
      const db = getDb();
      await db.tasks.add(baseTask({ syncStatus: "syncing" }));
      await db.outbox.add(baseOp({ status: "SENDING" }));

      await applyPushResponse(db, {
        results: [
          {
            operationId: "01991b1a-0000-7000-8000-0000000000a1",
            entityId: "01991b1a-0000-7000-8000-000000000001",
            outcome: "DUPLICATE_IGNORED",
          },
        ],
        serverTime: new Date().toISOString(),
      });

      const op = await db.outbox.get("01991b1a-0000-7000-8000-0000000000a1");
      expect(op).toBeUndefined();
    });

    it("CONFLICT preserva as duas versões e marca a entidade como conflito", async () => {
      const db = getDb();
      await db.tasks.add(baseTask({ syncStatus: "syncing" }));
      await db.outbox.add(baseOp({ status: "SENDING" }));

      await applyPushResponse(db, {
        results: [
          {
            operationId: "01991b1a-0000-7000-8000-0000000000a1",
            entityId: "01991b1a-0000-7000-8000-000000000001",
            outcome: "CONFLICT",
            conflictId: "01991b1a-0000-7000-8000-0000000000c1",
            serverVersion: 3,
            serverEntity: { ...baseTask(), title: "Versão do servidor", version: 3 },
          },
        ],
        serverTime: new Date().toISOString(),
      });

      const op = await db.outbox.get("01991b1a-0000-7000-8000-0000000000a1");
      expect(op?.status).toBe("CONFLICT");
      const task = await db.tasks.get("01991b1a-0000-7000-8000-000000000001");
      expect(task?.syncStatus).toBe("conflict");
      const conflict = await db.conflicts.get("01991b1a-0000-7000-8000-0000000000c1");
      expect(conflict?.clientPayload).toEqual(baseOp().payload);
      expect((conflict?.serverPayload as { title: string }).title).toBe("Versão do servidor");
    });

    it("REJECTED marca a outbox como FAILED e a entidade como erro, sem apagar nada", async () => {
      const db = getDb();
      await db.tasks.add(baseTask({ syncStatus: "syncing" }));
      await db.outbox.add(baseOp({ status: "SENDING" }));

      await applyPushResponse(db, {
        results: [
          {
            operationId: "01991b1a-0000-7000-8000-0000000000a1",
            entityId: "01991b1a-0000-7000-8000-000000000001",
            outcome: "REJECTED",
            rejectionReason: "EVENT_ACCESS_REVOKED",
          },
        ],
        serverTime: new Date().toISOString(),
      });

      const op = await db.outbox.get("01991b1a-0000-7000-8000-0000000000a1");
      expect(op?.status).toBe("FAILED");
      expect(op?.lastError).toBe("EVENT_ACCESS_REVOKED");
      const task = await db.tasks.get("01991b1a-0000-7000-8000-000000000001");
      expect(task?.syncStatus).toBe("error");
    });
  });

  describe("pushPendingOperations", () => {
    it("envia operações elegíveis e aplica o resultado", async () => {
      const db = getDb();
      await db.tasks.add(baseTask({ syncStatus: "pending" }));
      await db.outbox.add(baseOp());

      const fetchImpl = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [
            {
              operationId: "01991b1a-0000-7000-8000-0000000000a1",
              entityId: "01991b1a-0000-7000-8000-000000000001",
              outcome: "APPLIED",
              serverVersion: 2,
            },
          ],
          serverTime: new Date().toISOString(),
        }),
      });

      const { sent } = await pushPendingOperations(db, { deviceId, fetchImpl });
      expect(sent).toBe(1);
      expect(fetchImpl).toHaveBeenCalledWith("/api/sync/push", expect.objectContaining({ method: "POST" }));

      const op = await db.outbox.get("01991b1a-0000-7000-8000-0000000000a1");
      expect(op).toBeUndefined();
    });

    it("resposta parcial: operação sem resultado correspondente volta para PENDING com backoff (não fica presa em SENDING)", async () => {
      const db = getDb();
      await db.tasks.add(baseTask({ syncStatus: "pending" }));
      await db.tasks.add(baseTask({ id: "01991b1a-0000-7000-8000-000000000002", syncStatus: "pending" }));
      await db.outbox.add(baseOp());
      await db.outbox.add(
        baseOp({
          id: "01991b1a-0000-7000-8000-0000000000a2",
          entityId: "01991b1a-0000-7000-8000-000000000002",
        })
      );

      const fetchImpl = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [
            {
              // só a primeira operação recebe resultado — servidor "caiu" no meio do lote
              operationId: "01991b1a-0000-7000-8000-0000000000a1",
              entityId: "01991b1a-0000-7000-8000-000000000001",
              outcome: "APPLIED",
              serverVersion: 2,
            },
          ],
          serverTime: new Date().toISOString(),
        }),
      });

      await pushPendingOperations(db, { deviceId, fetchImpl });

      const stuckOp = await db.outbox.get("01991b1a-0000-7000-8000-0000000000a2");
      expect(stuckOp?.status).toBe("PENDING");
      expect(stuckOp?.lastError).toContain("resposta parcial");
      expect(new Date(stuckOp!.nextAttemptAt).getTime()).toBeGreaterThan(Date.now());
    });

    it("falha de rede devolve as operações para PENDING com backoff e relança o erro", async () => {
      const db = getDb();
      await db.tasks.add(baseTask({ syncStatus: "pending" }));
      await db.outbox.add(baseOp());

      const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));

      await expect(pushPendingOperations(db, { deviceId, fetchImpl })).rejects.toThrow("network down");

      const op = await db.outbox.get("01991b1a-0000-7000-8000-0000000000a1");
      expect(op?.status).toBe("PENDING");
      expect(op?.attempts).toBe(1);
      expect(op?.lastError).toBe("network down");
    });

    it("não envia nada quando não há operações elegíveis", async () => {
      const db = getDb();
      const fetchImpl = vi.fn();
      const { sent } = await pushPendingOperations(db, { deviceId, fetchImpl });
      expect(sent).toBe(0);
      expect(fetchImpl).not.toHaveBeenCalled();
    });
  });

  describe("pullChanges", () => {
    it("pagina automaticamente enquanto hasMore for true", async () => {
      const db = getDb();
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            changes: [],
            nextCursor: "cursor-page-1",
            hasMore: true,
            serverTime: new Date().toISOString(),
            accessRevoked: false,
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            changes: [],
            nextCursor: "cursor-page-2",
            hasMore: false,
            serverTime: new Date().toISOString(),
            accessRevoked: false,
          }),
        });

      await pullChanges(db, { eventId, fetchImpl });

      expect(fetchImpl).toHaveBeenCalledTimes(2);
      const cursor = await db.syncState.get(eventId);
      expect(cursor?.cursor).toBe("cursor-page-2");
    });

    it("lança AccessRevokedError quando o servidor sinaliza acesso revogado", async () => {
      const db = getDb();
      const fetchImpl = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          changes: [],
          nextCursor: "cursor-x",
          hasMore: false,
          serverTime: new Date().toISOString(),
          accessRevoked: true,
          revokedReason: "EVENT_ACCESS_REVOKED",
        }),
      });

      await expect(pullChanges(db, { eventId, fetchImpl })).rejects.toBeInstanceOf(AccessRevokedError);
    });
  });

  describe("runFullSyncCycle", () => {
    it("recupera operações presas em SENDING de uma sessão anterior antes de tentar enviar de novo", async () => {
      const db = getDb();
      await db.tasks.add(baseTask({ syncStatus: "syncing" }));
      await db.outbox.add(baseOp({ status: "SENDING" })); // simula app fechado no meio do envio

      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            results: [
              {
                operationId: "01991b1a-0000-7000-8000-0000000000a1",
                entityId: "01991b1a-0000-7000-8000-000000000001",
                outcome: "APPLIED",
                serverVersion: 2,
              },
            ],
            serverTime: new Date().toISOString(),
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            changes: [],
            nextCursor: "cursor-1",
            hasMore: false,
            serverTime: new Date().toISOString(),
            accessRevoked: false,
          }),
        });

      const result = await runFullSyncCycle(db, { eventId, deviceId, fetchImpl });

      expect(result.pushed).toBe(1);
      const op = await db.outbox.get("01991b1a-0000-7000-8000-0000000000a1");
      expect(op).toBeUndefined();
    });
  });
});
