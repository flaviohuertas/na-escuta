import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, resetDbInstanceForTests } from "@/lib/db/dexie/db";
import {
  isEventPreparedOffline,
  prepareEventForOffline,
  type PreparePhase,
  type PrepareProgress,
} from "@/lib/sync/bootstrap";

const eventId = "01991b1a-0000-7000-8000-000000000010";
const companyId = "01991b1a-0000-7000-8000-000000000099";

function makeBootstrapResponse(taskCount: number) {
  const now = new Date().toISOString();
  return {
    manifest: {
      eventId,
      cursor: "cursor-1",
      counts: {
        Event: 1,
        Task: taskCount,
        ChecklistTemplate: 0,
        ChecklistItem: 0,
        Occurrence: 0,
        OccurrenceEvidence: 0,
      },
      serverTime: now,
    },
    event: {
      id: eventId,
      companyId,
      name: "Festival de Teste",
      description: null,
      location: null,
      startDate: now,
      endDate: now,
      status: "CONFIRMED",
      version: 1,
      updatedAt: now,
    },
    changes: Array.from({ length: taskCount }, (_, i) => ({
      entityType: "Task" as const,
      entityId: `01991b1a-0000-7000-8000-00000000${String(i).padStart(4, "0")}`,
      version: 1,
      deletedAt: null,
      data: {
        id: `01991b1a-0000-7000-8000-00000000${String(i).padStart(4, "0")}`,
        eventId,
        companyId,
        title: `Tarefa ${i}`,
        description: null,
        status: "TODO",
        priority: 0,
        dueAt: null,
        assignedToUserId: null,
        version: 1,
        createdBy: null,
        updatedBy: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
      updatedAt: now,
    })),
  };
}

function makeFetchImpl(bootstrapResponse: ReturnType<typeof makeBootstrapResponse>): typeof fetch {
  const impl = vi.fn(async (url: string) => {
    if (url.includes("/api/sync/bootstrap")) {
      return { ok: true, json: async () => bootstrapResponse };
    }
    // Qualquer página adicional pedida via /api/sync/pull: nada mais a
    // baixar (o bootstrap já devolveu tudo na primeira página nestes testes).
    return {
      ok: true,
      json: async () => ({
        changes: [],
        nextCursor: bootstrapResponse.manifest.cursor,
        hasMore: false,
        serverTime: bootstrapResponse.manifest.serverTime,
        accessRevoked: false,
      }),
    };
  });
  return impl as unknown as typeof fetch;
}

describe("prepareEventForOffline", () => {
  beforeEach(() => resetDbInstanceForTests());
  afterEach(async () => {
    const db = getDb();
    db.close();
    await db.delete();
    resetDbInstanceForTests();
  });

  it("baixa evento e tarefas, e verifica que as contagens batem (evento fica marcado como preparado)", async () => {
    const db = getDb();
    const response = makeBootstrapResponse(2);
    const fetchImpl = makeFetchImpl(response);

    const progressLog: PreparePhase[] = [];
    const result = await prepareEventForOffline(db, eventId, {
      fetchImpl,
      onProgress: (p: PrepareProgress) => progressLog.push(p.phase),
    });

    expect(result.ok).toBe(true);
    expect(result.counts.Task).toEqual({ expected: 2, actual: 2 });
    expect(progressLog[0]).toBe("starting");
    expect(progressLog.at(-1)).toBe("done");

    const storedEvent = await db.events.get(eventId);
    expect(storedEvent?.name).toBe("Festival de Teste");
    const tasks = await db.tasks.where("eventId").equals(eventId).toArray();
    expect(tasks).toHaveLength(2);

    expect(await isEventPreparedOffline(db, eventId)).toBe(true);
  });

  it("marca como NÃO preparado (ok=false) quando a contagem local não bate com o manifesto (download incompleto)", async () => {
    const db = getDb();
    const response = makeBootstrapResponse(3);
    // Simula falha: manifesto promete 3 tarefas mas só 1 vem no changes[] (dado
    // corrompido/backend com bug) — a verificação deve pegar isso.
    response.manifest.counts.Task = 3;
    response.changes = response.changes.slice(0, 1);

    const fetchImpl = makeFetchImpl(response);

    const result = await prepareEventForOffline(db, eventId, { fetchImpl });

    expect(result.ok).toBe(false);
    expect(result.mismatched).toContain("Task");
    expect(result.counts.Task).toEqual({ expected: 3, actual: 1 });
    expect(await isEventPreparedOffline(db, eventId)).toBe(false);
  });

  describe("guardar as telas do evento (warmRoutes)", () => {
    const warmed = { serviceWorkerActive: true, cached: ["/eventos/x"], failed: [] as string[] };

    it("roda DEPOIS da verificação de dados e ANTES de marcar como preparado, e devolve o resultado", async () => {
      const db = getDb();
      const fetchImpl = makeFetchImpl(makeBootstrapResponse(1));
      const phases: PreparePhase[] = [];
      let preparedWhenWarming: boolean | null = null;
      const warmRoutes = vi.fn(async () => {
        preparedWhenWarming = await isEventPreparedOffline(db, eventId);
        return warmed;
      });

      const result = await prepareEventForOffline(db, eventId, {
        fetchImpl,
        warmRoutes,
        onProgress: (p) => phases.push(p.phase),
      });

      expect(warmRoutes).toHaveBeenCalledWith(eventId);
      // O selo "Disponível offline" depende de isPrepared: só pode acender com as telas já guardadas.
      expect(preparedWhenWarming).toBe(false);
      expect(await isEventPreparedOffline(db, eventId)).toBe(true);
      expect(result.routes).toEqual(warmed);
      expect(phases.slice(-3)).toEqual(["verifying", "caching", "done"]);
    });

    it("não roda quando a verificação de dados falha (não há o que guardar de um evento incompleto)", async () => {
      const db = getDb();
      const response = makeBootstrapResponse(3);
      response.changes = response.changes.slice(0, 1);
      const warmRoutes = vi.fn(async () => warmed);

      const result = await prepareEventForOffline(db, eventId, {
        fetchImpl: makeFetchImpl(response),
        warmRoutes,
      });

      expect(result.ok).toBe(false);
      expect(warmRoutes).not.toHaveBeenCalled();
      expect(result.routes).toBeUndefined();
    });

    it("falha ao guardar as telas NÃO invalida os dados: o evento fica preparado e o motivo é devolvido", async () => {
      const db = getDb();
      const failedWarm = { serviceWorkerActive: false, cached: [], failed: ["/eventos/x"] };

      const result = await prepareEventForOffline(db, eventId, {
        fetchImpl: makeFetchImpl(makeBootstrapResponse(1)),
        warmRoutes: async () => failedWarm,
      });

      expect(result.ok).toBe(true);
      expect(result.routes).toEqual(failedWarm);
      expect(await isEventPreparedOffline(db, eventId)).toBe(true);
    });

    it("exceção ao guardar as telas também não derruba a preparação", async () => {
      const db = getDb();

      const result = await prepareEventForOffline(db, eventId, {
        fetchImpl: makeFetchImpl(makeBootstrapResponse(1)),
        warmRoutes: async () => {
          throw new Error("boom");
        },
      });

      expect(result.ok).toBe(true);
      expect(result.routes).toBeUndefined();
      expect(await isEventPreparedOffline(db, eventId)).toBe(true);
    });
  });

  it("propaga erro quando o servidor responde com falha", async () => {
    const db = getDb();
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 403 });

    await expect(prepareEventForOffline(db, eventId, { fetchImpl })).rejects.toThrow();
  });
});
