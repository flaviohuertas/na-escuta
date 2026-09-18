import { getDb } from "@/lib/db/dexie/db";
import type { LocalTask } from "@/lib/db/dexie/schema";
import { TaskInputSchema, type TaskInput } from "@/lib/domain/task.schema";
import { generateEntityId } from "@/lib/sync/ids";
import { enqueueOperation } from "@/lib/sync/outbox";

export interface RepositoryContext {
  userId: string;
  companyId: string;
  deviceId: string;
}

/**
 * Toda leitura/gravação operacional deste domínio passa por aqui — nunca por
 * Server Action ou fetch. Criar e atualizar gravam a entidade E enfileiram a
 * outbox na MESMA transação Dexie (requisito de atomicidade): se a aba
 * fechar ou a transação falhar no meio, nenhuma das duas fica pra trás
 * sozinha.
 */
export async function createTask(input: TaskInput, ctx: RepositoryContext): Promise<LocalTask> {
  const parsed = TaskInputSchema.parse(input);
  const db = getDb();
  const id = generateEntityId();
  const now = new Date().toISOString();

  const entity: LocalTask = {
    id,
    companyId: ctx.companyId,
    eventId: parsed.eventId,
    title: parsed.title,
    description: parsed.description ?? null,
    status: parsed.status,
    priority: parsed.priority,
    dueAt: parsed.dueAt ?? null,
    assignedToUserId: parsed.assignedToUserId ?? null,
    version: 1,
    syncStatus: "pending",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    createdBy: ctx.userId,
    updatedBy: ctx.userId,
  };

  await db.transaction("rw", db.tasks, db.outbox, async () => {
    await db.tasks.add(entity);
    await enqueueOperation(db, {
      companyId: ctx.companyId,
      eventId: parsed.eventId,
      entityType: "Task",
      entityId: id,
      operationType: "CREATE",
      payload: entity as unknown as Record<string, unknown>,
      currentVersion: null,
      deviceId: ctx.deviceId,
    });
  });

  return entity;
}

export async function updateTask(
  id: string,
  patch: Partial<Omit<TaskInput, "eventId">>,
  ctx: RepositoryContext
): Promise<LocalTask> {
  const db = getDb();

  return db.transaction("rw", db.tasks, db.outbox, async () => {
    const existing = await db.tasks.get(id);
    if (!existing || existing.deletedAt) {
      throw new Error("Tarefa não encontrada localmente.");
    }

    const merged: LocalTask = {
      ...existing,
      ...patch,
      description: patch.description === undefined ? existing.description : patch.description,
      dueAt: patch.dueAt === undefined ? existing.dueAt : patch.dueAt,
      assignedToUserId:
        patch.assignedToUserId === undefined ? existing.assignedToUserId : patch.assignedToUserId,
      updatedAt: new Date().toISOString(),
      updatedBy: ctx.userId,
      syncStatus: "pending",
    };

    await db.tasks.put(merged);
    await enqueueOperation(db, {
      companyId: existing.companyId,
      eventId: existing.eventId,
      entityType: "Task",
      entityId: id,
      operationType: "UPDATE",
      payload: merged as unknown as Record<string, unknown>,
      currentVersion: existing.version,
      deviceId: ctx.deviceId,
    });

    return merged;
  });
}

/** Exclusão local é tombstone (deletedAt), nunca delete físico imediato — exceto quando cancela um CREATE ainda não sincronizado (ver enqueueOperation). */
export async function deleteTask(id: string, ctx: RepositoryContext): Promise<void> {
  const db = getDb();

  await db.transaction("rw", db.tasks, db.outbox, async () => {
    const existing = await db.tasks.get(id);
    if (!existing || existing.deletedAt) return;

    const now = new Date().toISOString();
    const tombstoned: LocalTask = {
      ...existing,
      deletedAt: now,
      updatedAt: now,
      updatedBy: ctx.userId,
      syncStatus: "pending",
    };

    const result = await enqueueOperation(db, {
      companyId: existing.companyId,
      eventId: existing.eventId,
      entityType: "Task",
      entityId: id,
      operationType: "DELETE",
      payload: { id },
      currentVersion: existing.version,
      deviceId: ctx.deviceId,
    });

    if (result.kind === "cancelled-create") {
      await db.tasks.delete(id);
    } else {
      await db.tasks.put(tombstoned);
    }
  });
}

export async function listTasksByEvent(eventId: string): Promise<LocalTask[]> {
  const db = getDb();
  const rows = await db.tasks.where("eventId").equals(eventId).toArray();
  return rows.filter((t) => !t.deletedAt).sort((a, b) => b.priority - a.priority || a.title.localeCompare(b.title));
}

export async function getTask(id: string): Promise<LocalTask | undefined> {
  const db = getDb();
  return db.tasks.get(id);
}
