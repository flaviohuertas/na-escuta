import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, resetDbInstanceForTests } from "@/lib/db/dexie/db";
import type { LocalConflict, LocalTask, OutboxOperation } from "@/lib/db/dexie/schema";
import { applyConflictResolution } from "@/lib/sync/conflict-resolution";

const eventId = "01991b1a-0000-7000-8000-000000000010";
const companyId = "01991b1a-0000-7000-8000-000000000099";
const taskId = "01991b1a-0000-7000-8000-000000000001";
const conflictOpId = "01991b1a-0000-7000-8000-0000000000a1";
const conflictId = "01991b1a-0000-7000-8000-0000000000c1";

function task(overrides: Partial<LocalTask> = {}): LocalTask {
  const now = new Date().toISOString();
  return {
    id: taskId,
    eventId,
    companyId,
    title: "Editado neste dispositivo",
    description: null,
    status: "DONE",
    priority: 0,
    dueAt: null,
    assignedToUserId: null,
    version: 1,
    syncStatus: "conflict",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    createdBy: null,
    updatedBy: null,
    ...overrides,
  };
}

function op(overrides: Partial<OutboxOperation> = {}): OutboxOperation {
  const now = new Date().toISOString();
  return {
    id: conflictOpId,
    companyId,
    eventId,
    entityType: "Task",
    entityId: taskId,
    operationType: "UPDATE",
    payload: { title: "Editado neste dispositivo" },
    baseVersion: 1,
    status: "CONFLICT",
    attempts: 1,
    lastAttemptAt: now,
    nextAttemptAt: now,
    lastError: null,
    createdAt: now,
    deviceId: "device-1",
    ...overrides,
  };
}

function conflict(): LocalConflict {
  return {
    id: conflictId,
    entityType: "Task",
    entityId: taskId,
    eventId,
    baseVersion: 1,
    serverVersion: 2,
    clientPayload: { title: "Editado neste dispositivo" },
    serverPayload: { title: "Versão do servidor" },
    operationId: conflictOpId,
    status: "PENDING",
    detectedAt: new Date().toISOString(),
    resolvedAt: null,
  };
}

/** Entidade como o servidor a devolve (linha do Prisma serializada em JSON). */
const serverEntity = {
  id: taskId,
  eventId,
  companyId,
  title: "Versão do servidor",
  description: null,
  status: "DONE",
  priority: 0,
  dueAt: null,
  assignedToUserId: null,
  version: 2,
  createdBy: null,
  updatedBy: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-19T10:00:00.000Z",
  deletedAt: null,
};

describe("applyConflictResolution", () => {
  beforeEach(() => resetDbInstanceForTests());
  afterEach(async () => {
    const db = getDb();
    db.close();
    await db.delete();
    resetDbInstanceForTests();
  });

  it("'Manter o servidor': a cópia local converge para a entidade do servidor e o conflito fecha", async () => {
    // Regressão: o servidor não muda nesse caso (mesma versão), então o pull nunca trazia a
    // entidade de volta — a tarefa local ficava com o valor descartado e o selo "conflito".
    const db = getDb();
    await db.tasks.add(task());
    await db.outbox.add(op());
    await db.conflicts.add(conflict());

    await applyConflictResolution(db, conflict(), serverEntity);

    const local = await db.tasks.get(taskId);
    expect(local?.title).toBe("Versão do servidor");
    expect(local?.version).toBe(2);
    expect(local?.syncStatus).toBe("synced");
    expect(await db.outbox.get(conflictOpId)).toBeUndefined();
    const closed = await db.conflicts.get(conflictId);
    expect(closed?.status).toBe("RESOLVED");
    expect(closed?.resolvedAt).not.toBeNull();
  });

  it("'Manter o meu': a entidade devolvida já traz o valor do dispositivo numa versão nova", async () => {
    const db = getDb();
    await db.tasks.add(task());
    await db.outbox.add(op());
    await db.conflicts.add(conflict());

    await applyConflictResolution(db, conflict(), {
      ...serverEntity,
      title: "Editado neste dispositivo",
      version: 3,
    });

    const local = await db.tasks.get(taskId);
    expect(local?.title).toBe("Editado neste dispositivo");
    expect(local?.version).toBe(3);
    expect(local?.syncStatus).toBe("synced");
  });

  it("não atropela edições feitas depois do conflito: elas seguem na outbox, só o conflito fecha", async () => {
    const db = getDb();
    await db.tasks.add(task({ title: "Continuei editando", syncStatus: "pending" }));
    await db.outbox.add(op());
    await db.outbox.add(
      op({ id: "01991b1a-0000-7000-8000-0000000000a2", status: "PENDING", payload: { title: "Continuei editando" } })
    );
    await db.conflicts.add(conflict());

    await applyConflictResolution(db, conflict(), serverEntity);

    expect((await db.tasks.get(taskId))?.title).toBe("Continuei editando");
    expect(await db.outbox.get(conflictOpId)).toBeUndefined();
    expect((await db.outbox.get("01991b1a-0000-7000-8000-0000000000a2"))?.status).toBe("PENDING");
    expect((await db.conflicts.get(conflictId))?.status).toBe("RESOLVED");
  });

  it("não atropela a cópia local enquanto OUTRO conflito da mesma entidade ainda está aberto", async () => {
    // Duas edições offline da mesma tarefa que o servidor recusou: a cópia local carrega o valor
    // da segunda. Resolver a primeira não pode sobrescrevê-la — a segunda ainda não foi decidida.
    const db = getDb();
    const secondOpId = "01991b1a-0000-7000-8000-0000000000a3";
    await db.tasks.add(task({ title: "Valor do segundo conflito" }));
    await db.outbox.add(op());
    await db.outbox.add(op({ id: secondOpId, payload: { title: "Valor do segundo conflito" } }));
    await db.conflicts.add(conflict());

    await applyConflictResolution(db, conflict(), serverEntity);

    const local = await db.tasks.get(taskId);
    expect(local?.title).toBe("Valor do segundo conflito");
    expect(local?.syncStatus).toBe("conflict");
    expect((await db.outbox.get(secondOpId))?.status).toBe("CONFLICT");
    expect(await db.outbox.get(conflictOpId)).toBeUndefined();
    expect((await db.conflicts.get(conflictId))?.status).toBe("RESOLVED");
  });

  it("sem entidade na resposta, só limpa os marcadores e não mexe nos dados locais", async () => {
    const db = getDb();
    await db.tasks.add(task());
    await db.outbox.add(op());
    await db.conflicts.add(conflict());

    await applyConflictResolution(db, conflict(), null);

    expect((await db.tasks.get(taskId))?.title).toBe("Editado neste dispositivo");
    expect(await db.outbox.get(conflictOpId)).toBeUndefined();
    expect((await db.conflicts.get(conflictId))?.status).toBe("RESOLVED");
  });
});
