import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, resetDbInstanceForTests } from "@/lib/db/dexie/db";
import { decryptPendingExport, exportPendingChangesEncrypted } from "@/lib/sync/export-pending";

describe("export-pending (criptografia AES-GCM das alterações pendentes)", () => {
  beforeEach(() => resetDbInstanceForTests());
  afterEach(async () => {
    const db = getDb();
    db.close();
    await db.delete();
    resetDbInstanceForTests();
  });

  it("exporta e depois decripta com a senha correta, recuperando os dados originais", async () => {
    const db = getDb();
    await db.outbox.add({
      id: "01991b1a-0000-7000-8000-0000000000a1",
      companyId: "c1",
      eventId: "e1",
      entityType: "Task",
      entityId: "t1",
      operationType: "CREATE",
      payload: { title: "Tarefa pendente" },
      baseVersion: null,
      status: "PENDING",
      attempts: 0,
      lastAttemptAt: null,
      nextAttemptAt: new Date().toISOString(),
      lastError: null,
      createdAt: new Date().toISOString(),
      deviceId: "device-1",
    });

    const exported = await exportPendingChangesEncrypted(db, "senha-forte-123");
    const decrypted = await decryptPendingExport(exported, "senha-forte-123");

    expect(decrypted.outbox).toHaveLength(1);
    expect((decrypted.outbox[0] as { payload: { title: string } }).payload.title).toBe(
      "Tarefa pendente"
    );
  });

  it("falha ao decriptar com a senha errada (não é proteção decorativa)", async () => {
    const db = getDb();
    await db.outbox.add({
      id: "01991b1a-0000-7000-8000-0000000000a1",
      companyId: "c1",
      eventId: "e1",
      entityType: "Task",
      entityId: "t1",
      operationType: "CREATE",
      payload: { title: "Tarefa pendente" },
      baseVersion: null,
      status: "PENDING",
      attempts: 0,
      lastAttemptAt: null,
      nextAttemptAt: new Date().toISOString(),
      lastError: null,
      createdAt: new Date().toISOString(),
      deviceId: "device-1",
    });

    const exported = await exportPendingChangesEncrypted(db, "senha-correta");
    await expect(decryptPendingExport(exported, "senha-errada")).rejects.toThrow();
  });
});
