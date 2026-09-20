import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppDatabase } from "@/lib/db/dexie/schema";

describe("AppDatabase (Dexie schema)", () => {
  let db: AppDatabase;

  beforeEach(async () => {
    db = new AppDatabase();
    await db.open();
  });

  afterEach(async () => {
    db.close();
    await db.delete();
  });

  it("abre o banco e expõe todas as tabelas esperadas", () => {
    expect(db.tables.map((t) => t.name).sort()).toEqual(
      [
        "checklistItems",
        "checklists",
        "conflicts",
        "deviceState",
        "evidenceBlobs",
        "events",
        "occurrenceEvidence",
        "occurrences",
        "outbox",
        "session",
        "syncState",
        "tasks",
      ].sort()
    );
  });

  it("upgrade v1 → v2: quem já usa o app NÃO perde nada e ganha a tabela do aviso de aparelho revogado", async () => {
    // A v2 só acrescenta uma tabela. Provar com um banco v1 REAL, cheio de dados de campo: um upgrade
    // que falhasse (ou esvaziasse) apagaria o trabalho não enviado de todo aparelho já em uso.
    db.close();
    await db.delete();
    const legacy = new Dexie("na-escuta");
    legacy.version(1).stores({
      events: "id, companyId, updatedAt, syncStatus, deletedAt",
      tasks: "id, eventId, companyId, status, updatedAt, syncStatus, deletedAt, assignedToUserId",
      checklists: "id, eventId, companyId, updatedAt, syncStatus, deletedAt",
      checklistItems: "id, checklistId, eventId, companyId, status, updatedAt, syncStatus, deletedAt",
      occurrences: "id, eventId, companyId, status, severity, updatedAt, syncStatus, deletedAt",
      occurrenceEvidence: "id, occurrenceId, eventId, companyId, updatedAt, syncStatus, deletedAt",
      evidenceBlobs: "id",
      outbox: "id, entityId, [entityType+entityId], status, eventId, nextAttemptAt, createdAt",
      syncState: "key",
      session: "key",
      conflicts: "id, entityType, entityId, status, detectedAt",
    });
    await legacy.open();
    await legacy.table("outbox").add({ id: "op-1", eventId: "e1", entityType: "Task", entityId: "t1", status: "PENDING", payload: { title: "Trabalho de campo" } });
    await legacy.table("syncState").add({ key: "e1", cursor: "c", lastFullBootstrapAt: "2026-09-19T10:00:00.000Z" });
    legacy.close();

    db = new AppDatabase();
    await db.open();

    expect(await db.outbox.get("op-1")).toMatchObject({ payload: { title: "Trabalho de campo" }, status: "PENDING" });
    expect(await db.syncState.get("e1")).toMatchObject({ cursor: "c" });
    expect(await db.deviceState.count()).toBe(0);
    await db.deviceState.put({ key: "revocation", revokedAt: "2026-09-20T10:00:00.000Z", reason: null, userId: null });
    expect(await db.deviceState.get("revocation")).toBeDefined();
  });

  it("grava e lê uma tarefa local", async () => {
    const now = new Date().toISOString();
    await db.tasks.add({
      id: "01991b1a-0000-7000-8000-000000000001",
      eventId: "01991b1a-0000-7000-8000-000000000002",
      companyId: "01991b1a-0000-7000-8000-000000000003",
      title: "Testar Dexie",
      description: null,
      status: "TODO",
      priority: 0,
      dueAt: null,
      assignedToUserId: null,
      version: 1,
      syncStatus: "pending",
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      createdBy: null,
      updatedBy: null,
    });

    const found = await db.tasks.get("01991b1a-0000-7000-8000-000000000001");
    expect(found?.title).toBe("Testar Dexie");
  });

  it("consulta a outbox pelo índice composto [entityType+entityId]", async () => {
    await db.outbox.add({
      id: "01991b1a-0000-7000-8000-0000000000a1",
      companyId: "c1",
      eventId: "e1",
      entityType: "Task",
      entityId: "t1",
      operationType: "CREATE",
      payload: { title: "x" },
      baseVersion: null,
      status: "PENDING",
      attempts: 0,
      lastAttemptAt: null,
      nextAttemptAt: new Date().toISOString(),
      lastError: null,
      createdAt: new Date().toISOString(),
      deviceId: "device-1",
    });

    const match = await db.outbox
      .where("[entityType+entityId]")
      .equals(["Task", "t1"])
      .first();

    expect(match?.id).toBe("01991b1a-0000-7000-8000-0000000000a1");
  });
});
