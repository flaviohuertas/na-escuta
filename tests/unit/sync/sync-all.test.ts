import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, resetDbInstanceForTests } from "@/lib/db/dexie/db";
import { describeAccessRevoked } from "@/lib/sync/access";
import { listPreparedEventIds } from "@/lib/sync/bootstrap";
import { syncAllPreparedEvents } from "@/lib/sync/sync-all";

// Ordem alfabética das chaves = ordem em que o laço percorre: o evento REVOGADO vem primeiro.
const revokedEvent = "01991b1a-0000-7000-8000-0000000000a0";
const healthyEvent = "01991b1a-0000-7000-8000-0000000000b0";
const companyId = "01991b1a-0000-7000-8000-000000000099";
const deviceId = "device-1";

async function prepare(eventId: string) {
  await getDb().syncState.put({
    key: eventId,
    cursor: "antigo",
    lastSyncAt: "2026-09-19T10:00:00.000Z",
    lastFullBootstrapAt: "2026-09-19T10:00:00.000Z",
    expectedCounts: null,
  });
}

async function putTask(id: string, eventId: string) {
  await getDb().tasks.add({
    id,
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
    createdAt: "2026-09-19T10:00:00.000Z",
    updatedAt: "2026-09-19T10:00:00.000Z",
    deletedAt: null,
    createdBy: null,
    updatedBy: null,
  });
}

const okPull = (cursor: string) => ({
  changes: [],
  nextCursor: cursor,
  hasMore: false,
  serverTime: "2026-09-19T12:00:00.000Z",
  accessRevoked: false,
});

const revokedPull = (reason: string) => ({
  changes: [],
  nextCursor: "antigo",
  hasMore: false,
  serverTime: "2026-09-19T12:00:00.000Z",
  accessRevoked: true,
  revokedReason: reason,
});

/** Servidor falso: cada evento responde o que o teste mandar; nada pendente na outbox, então não há push. */
function fakeServer(byEvent: Record<string, () => { status: number; body: unknown }>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    const eventId = url.searchParams.get("eventId") ?? "";
    const { status, body } = byEvent[eventId]!();
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
  }) as unknown as typeof fetch;
}

describe("syncAllPreparedEvents", () => {
  beforeEach(() => resetDbInstanceForTests());
  afterEach(async () => {
    const db = getDb();
    db.close();
    await db.delete();
    resetDbInstanceForTests();
  });

  it("o acesso revogado a UM evento não impede os outros de sincronizar", async () => {
    // Regressão: o erro abortava o laço; como o evento revogado seguia na lista (e vinha primeiro),
    // NENHUM evento do aparelho voltava a sincronizar.
    const db = getDb();
    await prepare(revokedEvent);
    await prepare(healthyEvent);
    const fetchImpl = fakeServer({
      [revokedEvent]: () => ({ status: 200, body: revokedPull("EVENT_ACCESS_REVOKED") }),
      [healthyEvent]: () => ({ status: 200, body: okPull("cursor-novo") }),
    });

    const result = await syncAllPreparedEvents(db, { deviceId, fetchImpl });

    expect(result.revokedEventIds).toEqual([revokedEvent]);
    expect((await db.syncState.get(healthyEvent))?.cursor).toBe("cursor-novo");
    expect((await db.syncState.get(healthyEvent))?.accessRevokedAt ?? null).toBeNull();
  });

  it("anota no aparelho, para a tela do evento explicar, que o acesso foi recusado e por quê", async () => {
    const db = getDb();
    await prepare(revokedEvent);
    const fetchImpl = fakeServer({ [revokedEvent]: () => ({ status: 200, body: revokedPull("MEMBERSHIP_REVOKED") }) });

    await syncAllPreparedEvents(db, { deviceId, fetchImpl });

    const state = await db.syncState.get(revokedEvent);
    expect(state?.accessRevokedAt).toEqual(expect.any(String));
    expect(state?.accessRevokedReason).toBe("MEMBERSHIP_REVOKED");
  });

  it("TIRA do aparelho o que o servidor já guarda do evento revogado — e só dele", async () => {
    // Antes o dado ficava para sempre: quem perdia o acesso seguia vendo o evento no aparelho.
    const db = getDb();
    await prepare(revokedEvent);
    await prepare(healthyEvent);
    await putTask("01991b1a-0000-7000-8000-000000000001", revokedEvent);
    await putTask("01991b1a-0000-7000-8000-000000000002", healthyEvent);
    const fetchImpl = fakeServer({
      [revokedEvent]: () => ({ status: 200, body: revokedPull("EVENT_ACCESS_REVOKED") }),
      [healthyEvent]: () => ({ status: 200, body: okPull("cursor-novo") }),
    });

    await syncAllPreparedEvents(db, { deviceId, fetchImpl });

    expect((await db.tasks.toArray()).map((t) => t.eventId)).toEqual([healthyEvent]);
  });

  it("NÃO apaga o que só existe no aparelho: as alterações ainda não enviadas do evento revogado", async () => {
    const db = getDb();
    await prepare(revokedEvent);
    await db.outbox.add({
      id: "01991b1a-0000-7000-8000-0000000000c1",
      companyId,
      eventId: revokedEvent,
      entityType: "Task",
      entityId: "01991b1a-0000-7000-8000-000000000003",
      operationType: "CREATE",
      payload: { title: "Criada em campo, nunca enviada" },
      baseVersion: null,
      // FAILED: o servidor a recusou no push do mesmo ciclo (sem acesso). Ainda assim é do aparelho.
      status: "FAILED",
      attempts: 1,
      lastAttemptAt: "2026-09-19T11:00:00.000Z",
      nextAttemptAt: "2026-09-19T11:00:00.000Z",
      lastError: "EVENT_ACCESS_REVOKED",
      createdAt: "2026-09-19T10:30:00.000Z",
      deviceId,
    });
    const fetchImpl = fakeServer({ [revokedEvent]: () => ({ status: 200, body: revokedPull("EVENT_ACCESS_REVOKED") }) });

    await syncAllPreparedEvents(db, { deviceId, fetchImpl });

    expect(await db.outbox.count()).toBe(1);
    expect((await db.outbox.toArray())[0]?.payload).toEqual({ title: "Criada em campo, nunca enviada" });
  });

  it("depois de revogado o evento não é mais sincronizado (deixa de ser 'preparado'): não fica batendo no servidor a cada ciclo", async () => {
    const db = getDb();
    await prepare(revokedEvent);
    const fetchImpl = fakeServer({ [revokedEvent]: () => ({ status: 200, body: revokedPull("EVENT_ACCESS_REVOKED") }) });
    await syncAllPreparedEvents(db, { deviceId, fetchImpl });
    vi.mocked(fetchImpl).mockClear();

    const second = await syncAllPreparedEvents(db, { deviceId, fetchImpl });

    expect(second.revokedEventIds).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("o motivo do servidor vira o aviso mesmo quando ele não manda motivo nenhum", async () => {
    const db = getDb();
    await prepare(revokedEvent);
    const noReason = { changes: [], nextCursor: "antigo", hasMore: false, serverTime: "2026-09-19T12:00:00.000Z", accessRevoked: true };
    const fetchImpl = fakeServer({ [revokedEvent]: () => ({ status: 200, body: noReason }) });

    await syncAllPreparedEvents(db, { deviceId, fetchImpl });

    const state = await db.syncState.get(revokedEvent);
    expect(state?.accessRevokedAt).toEqual(expect.any(String));
    expect(state?.accessRevokedReason ?? null).toBeNull();
    expect(await listPreparedEventIds(db)).toEqual([]);
  });

  it("qualquer OUTRO erro (rede, servidor) continua abortando o ciclo, como antes", async () => {
    const db = getDb();
    await prepare(revokedEvent);
    await prepare(healthyEvent);
    const fetchImpl = fakeServer({
      [revokedEvent]: () => ({ status: 500, body: {} }),
      [healthyEvent]: () => ({ status: 200, body: okPull("x") }),
    });

    await expect(syncAllPreparedEvents(db, { deviceId, fetchImpl })).rejects.toThrow(/status 500/);
  });

  it("sem evento preparado não faz nada", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const result = await syncAllPreparedEvents(getDb(), { deviceId, fetchImpl });
    expect(result.revokedEventIds).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("describeAccessRevoked", () => {
  it("traduz cada motivo em uma frase para a pessoa, nunca o código cru", () => {
    expect(describeAccessRevoked("EVENT_ACCESS_REVOKED")).toBe("Seu acesso a este evento foi retirado.");
    expect(describeAccessRevoked("MEMBERSHIP_REVOKED")).toMatch(/vínculo com a empresa/);
    expect(describeAccessRevoked("ENTITY_NOT_FOUND")).toBe("Este evento não existe mais.");
    for (const reason of [undefined, null, "", "MOTIVO_NOVO"]) {
      const text = describeAccessRevoked(reason);
      expect(text).toBe("Seu acesso a este evento foi encerrado.");
      expect(text).not.toMatch(/_/);
    }
  });
});

