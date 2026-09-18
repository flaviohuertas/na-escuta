import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, resetDbInstanceForTests } from "@/lib/db/dexie/db";
import {
  createTask,
  deleteTask,
  listTasksByEvent,
  updateTask,
} from "@/lib/repositories/task.repository";

const ctx = { userId: "user-1", companyId: "company-1", deviceId: "device-1" };
const eventId = "01991b1a-0000-7000-8000-000000000010";

describe("task.repository", () => {
  beforeEach(() => {
    resetDbInstanceForTests();
  });

  afterEach(async () => {
    const db = getDb();
    db.close();
    await db.delete();
    resetDbInstanceForTests();
  });

  it("createTask grava a tarefa e enfileira CREATE na outbox na mesma transação", async () => {
    const task = await createTask({ eventId, title: "Montar palco" }, ctx);
    const db = getDb();

    const stored = await db.tasks.get(task.id);
    expect(stored).toBeDefined();
    expect(stored?.syncStatus).toBe("pending");

    const ops = await db.outbox.where("entityId").equals(task.id).toArray();
    expect(ops).toHaveLength(1);
    expect(ops[0]?.operationType).toBe("CREATE");
    expect(ops[0]?.baseVersion).toBeNull();
  });

  it("reverte a gravação da tarefa se o enfileiramento na outbox falhar (atomicidade)", async () => {
    const db = getDb();
    vi.spyOn(db.outbox, "add").mockRejectedValueOnce(new Error("falha simulada"));

    await expect(createTask({ eventId, title: "Vai falhar" }, ctx)).rejects.toThrow();

    const allTasks = await db.tasks.toArray();
    expect(allTasks).toHaveLength(0);
    const allOps = await db.outbox.toArray();
    expect(allOps).toHaveLength(0);
  });

  it("updateTask mescla em uma operação PENDING existente preservando o baseVersion original", async () => {
    const task = await createTask({ eventId, title: "Original" }, ctx);
    const db = getDb();

    await updateTask(task.id, { title: "Editado 1" }, ctx);
    await updateTask(task.id, { title: "Editado 2" }, ctx);

    const ops = await db.outbox.where("entityId").equals(task.id).toArray();
    expect(ops).toHaveLength(1);
    expect(ops[0]?.operationType).toBe("CREATE");
    expect((ops[0]?.payload as { title: string }).title).toBe("Editado 2");

    const stored = await db.tasks.get(task.id);
    expect(stored?.title).toBe("Editado 2");
  });

  it("updateTask após a criação já ter sido sincronizada cria uma nova operação UPDATE com baseVersion correto", async () => {
    const task = await createTask({ eventId, title: "Original" }, ctx);
    const db = getDb();
    // Simula confirmação do servidor: outbox limpa, versão 1 confirmada.
    await db.outbox.clear();
    await db.tasks.update(task.id, { version: 1, syncStatus: "synced" });

    await updateTask(task.id, { title: "Depois do sync" }, ctx);

    const ops = await db.outbox.where("entityId").equals(task.id).toArray();
    expect(ops).toHaveLength(1);
    expect(ops[0]?.operationType).toBe("UPDATE");
    expect(ops[0]?.baseVersion).toBe(1);
  });

  it("deleteTask antes de qualquer sync cancela a operação e remove fisicamente o registro local", async () => {
    const task = await createTask({ eventId, title: "Nunca sincronizada" }, ctx);
    const db = getDb();

    await deleteTask(task.id, ctx);

    const stored = await db.tasks.get(task.id);
    expect(stored).toBeUndefined();
    const ops = await db.outbox.where("entityId").equals(task.id).toArray();
    expect(ops).toHaveLength(0);
  });

  it("deleteTask após sync grava tombstone e enfileira DELETE", async () => {
    const task = await createTask({ eventId, title: "Já sincronizada" }, ctx);
    const db = getDb();
    await db.outbox.clear();
    await db.tasks.update(task.id, { version: 1, syncStatus: "synced" });

    await deleteTask(task.id, ctx);

    const stored = await db.tasks.get(task.id);
    expect(stored?.deletedAt).not.toBeNull();
    const ops = await db.outbox.where("entityId").equals(task.id).toArray();
    expect(ops).toHaveLength(1);
    expect(ops[0]?.operationType).toBe("DELETE");
  });

  it("listTasksByEvent nunca retorna tarefas com tombstone", async () => {
    const t1 = await createTask({ eventId, title: "Ativa" }, ctx);
    const t2 = await createTask({ eventId, title: "Vai sumir" }, ctx);
    const db = getDb();
    await db.outbox.clear();
    await db.tasks.update(t2.id, { version: 1, syncStatus: "synced" });
    await deleteTask(t2.id, ctx);

    const list = await listTasksByEvent(eventId);
    expect(list.map((t) => t.id)).toEqual([t1.id]);
  });
});
