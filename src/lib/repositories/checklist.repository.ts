import { getDb } from "@/lib/db/dexie/db";
import type { LocalChecklistItem, LocalChecklistTemplate } from "@/lib/db/dexie/schema";
import {
  ChecklistItemInputSchema,
  ChecklistTemplateInputSchema,
  type ChecklistItemInput,
  type ChecklistTemplateInput,
} from "@/lib/domain/checklist.schema";
import { generateEntityId } from "@/lib/sync/ids";
import { enqueueOperation } from "@/lib/sync/outbox";
import type { RepositoryContext } from "./task.repository";

export async function createChecklistTemplate(
  input: ChecklistTemplateInput,
  ctx: RepositoryContext
): Promise<LocalChecklistTemplate> {
  const parsed = ChecklistTemplateInputSchema.parse(input);
  const db = getDb();
  const id = generateEntityId();
  const now = new Date().toISOString();

  const entity: LocalChecklistTemplate = {
    id,
    companyId: ctx.companyId,
    eventId: parsed.eventId,
    title: parsed.title,
    description: parsed.description ?? null,
    version: 1,
    syncStatus: "pending",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    createdBy: ctx.userId,
    updatedBy: ctx.userId,
  };

  await db.transaction("rw", db.checklists, db.outbox, async () => {
    await db.checklists.add(entity);
    await enqueueOperation(db, {
      companyId: ctx.companyId,
      eventId: parsed.eventId,
      entityType: "ChecklistTemplate",
      entityId: id,
      operationType: "CREATE",
      payload: entity as unknown as Record<string, unknown>,
      currentVersion: null,
      deviceId: ctx.deviceId,
    });
  });

  return entity;
}

export async function createChecklistItem(
  input: ChecklistItemInput,
  ctx: RepositoryContext
): Promise<LocalChecklistItem> {
  const parsed = ChecklistItemInputSchema.parse(input);
  const db = getDb();
  const id = generateEntityId();
  const now = new Date().toISOString();

  const entity: LocalChecklistItem = {
    id,
    companyId: ctx.companyId,
    eventId: parsed.eventId,
    checklistId: parsed.checklistId,
    label: parsed.label,
    order: parsed.order,
    isRequired: parsed.isRequired,
    status: parsed.status,
    doneAt: parsed.doneAt ?? null,
    doneByUserId: parsed.doneByUserId ?? null,
    version: 1,
    syncStatus: "pending",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    createdBy: ctx.userId,
    updatedBy: ctx.userId,
  };

  await db.transaction("rw", db.checklistItems, db.outbox, async () => {
    await db.checklistItems.add(entity);
    await enqueueOperation(db, {
      companyId: ctx.companyId,
      eventId: parsed.eventId,
      entityType: "ChecklistItem",
      entityId: id,
      operationType: "CREATE",
      payload: entity as unknown as Record<string, unknown>,
      currentVersion: null,
      deviceId: ctx.deviceId,
    });
  });

  return entity;
}

/** Marca (ou desmarca) um item de checklist — a operação mais comum em campo. */
export async function setChecklistItemStatus(
  id: string,
  status: LocalChecklistItem["status"],
  ctx: RepositoryContext
): Promise<LocalChecklistItem> {
  const db = getDb();

  return db.transaction("rw", db.checklistItems, db.outbox, async () => {
    const existing = await db.checklistItems.get(id);
    if (!existing || existing.deletedAt) {
      throw new Error("Item de checklist não encontrado localmente.");
    }

    const now = new Date().toISOString();
    const merged: LocalChecklistItem = {
      ...existing,
      status,
      doneAt: status === "DONE" ? now : null,
      doneByUserId: status === "DONE" ? ctx.userId : null,
      updatedAt: now,
      updatedBy: ctx.userId,
      syncStatus: "pending",
    };

    await db.checklistItems.put(merged);
    await enqueueOperation(db, {
      companyId: existing.companyId,
      eventId: existing.eventId,
      entityType: "ChecklistItem",
      entityId: id,
      operationType: "UPDATE",
      payload: merged as unknown as Record<string, unknown>,
      currentVersion: existing.version,
      deviceId: ctx.deviceId,
    });

    return merged;
  });
}

export async function listChecklistsByEvent(eventId: string): Promise<LocalChecklistTemplate[]> {
  const db = getDb();
  const rows = await db.checklists.where("eventId").equals(eventId).toArray();
  return rows.filter((c) => !c.deletedAt);
}

export async function listChecklistItems(checklistId: string): Promise<LocalChecklistItem[]> {
  const db = getDb();
  const rows = await db.checklistItems.where("checklistId").equals(checklistId).toArray();
  return rows.filter((i) => !i.deletedAt).sort((a, b) => a.order - b.order);
}
