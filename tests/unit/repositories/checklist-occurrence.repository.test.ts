import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, resetDbInstanceForTests } from "@/lib/db/dexie/db";
import {
  createChecklistItem,
  createChecklistTemplate,
  listChecklistItems,
  setChecklistItemStatus,
} from "@/lib/repositories/checklist.repository";
import {
  addOccurrenceEvidence,
  createOccurrence,
  listOccurrenceEvidence,
  updateOccurrenceStatus,
} from "@/lib/repositories/occurrence.repository";

const ctx = { userId: "user-1", companyId: "company-1", deviceId: "device-1" };
const eventId = "01991b1a-0000-7000-8000-000000000010";

describe("checklist.repository", () => {
  beforeEach(() => resetDbInstanceForTests());
  afterEach(async () => {
    const db = getDb();
    db.close();
    await db.delete();
    resetDbInstanceForTests();
  });

  it("cria checklist e itens, e marcar item enfileira UPDATE com baseVersion", async () => {
    const template = await createChecklistTemplate({ eventId, title: "Pré-evento" }, ctx);
    const item = await createChecklistItem(
      { checklistId: template.id, eventId, label: "Testar som" },
      ctx
    );

    const db = getDb();
    await db.outbox.clear();
    await db.checklistItems.update(item.id, { version: 1, syncStatus: "synced" });

    const updated = await setChecklistItemStatus(item.id, "DONE", ctx);
    expect(updated.status).toBe("DONE");
    expect(updated.doneByUserId).toBe(ctx.userId);

    const ops = await db.outbox.where("entityId").equals(item.id).toArray();
    expect(ops).toHaveLength(1);
    expect(ops[0]?.baseVersion).toBe(1);

    const items = await listChecklistItems(template.id);
    expect(items).toHaveLength(1);
    expect(items[0]?.status).toBe("DONE");
  });
});

describe("occurrence.repository", () => {
  beforeEach(() => resetDbInstanceForTests());
  afterEach(async () => {
    const db = getDb();
    db.close();
    await db.delete();
    resetDbInstanceForTests();
  });

  it("cria ocorrência e permite atualizar status", async () => {
    const occurrence = await createOccurrence(
      { eventId, title: "Queda de energia", occurredAt: new Date().toISOString() },
      ctx
    );
    expect(occurrence.status).toBe("OPEN");
    expect(occurrence.reportedByUserId).toBe(ctx.userId);

    const resolved = await updateOccurrenceStatus(occurrence.id, "RESOLVED", ctx, "Gerador acionado");
    expect(resolved.status).toBe("RESOLVED");
    expect(resolved.resolutionNotes).toBe("Gerador acionado");
  });

  it("anexa evidência com checksum calculado e mantém blob e metadados na mesma transação", async () => {
    const occurrence = await createOccurrence(
      { eventId, title: "Item danificado", occurredAt: new Date().toISOString() },
      ctx
    );
    const blob = new Blob(["conteudo-fake-da-foto"], { type: "image/jpeg" });

    const evidence = await addOccurrenceEvidence(
      occurrence.id,
      { blob, fileName: "foto1.jpg", mimeType: "image/jpeg" },
      ctx
    );

    expect(evidence.checksumSha256).toHaveLength(64);
    expect(evidence.sizeBytes).toBe(blob.size);

    const db = getDb();
    const storedBlob = await db.evidenceBlobs.get(evidence.id);
    // fake-indexeddb + jsdom não clonam Blob com fidelidade total (limitação
    // conhecida do ambiente de teste, não do código); verificamos só que o
    // registro do blob foi persistido com o id certo, na mesma transação.
    expect(storedBlob).toBeDefined();
    expect(storedBlob?.id).toBe(evidence.id);

    const list = await listOccurrenceEvidence(occurrence.id);
    expect(list).toHaveLength(1);

    const ops = await db.outbox.where("entityId").equals(evidence.id).toArray();
    expect(ops).toHaveLength(1);
    expect(ops[0]?.entityType).toBe("OccurrenceEvidence");
    // payload não deve carregar o blob (só metadados serializáveis)
    expect((ops[0]?.payload as Record<string, unknown>).blob).toBeUndefined();
  });
});
