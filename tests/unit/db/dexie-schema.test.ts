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
