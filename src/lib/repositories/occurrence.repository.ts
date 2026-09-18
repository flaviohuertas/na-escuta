import { getDb } from "@/lib/db/dexie/db";
import type { LocalOccurrence, LocalOccurrenceEvidence } from "@/lib/db/dexie/schema";
import {
  OccurrenceInputSchema,
  type OccurrenceInput,
} from "@/lib/domain/occurrence.schema";
import { generateEntityId } from "@/lib/sync/ids";
import { enqueueOperation } from "@/lib/sync/outbox";
import type { RepositoryContext } from "./task.repository";

export async function createOccurrence(
  input: OccurrenceInput,
  ctx: RepositoryContext
): Promise<LocalOccurrence> {
  const parsed = OccurrenceInputSchema.parse(input);
  const db = getDb();
  const id = generateEntityId();
  const now = new Date().toISOString();

  const entity: LocalOccurrence = {
    id,
    companyId: ctx.companyId,
    eventId: parsed.eventId,
    title: parsed.title,
    description: parsed.description ?? null,
    category: parsed.category ?? null,
    severity: parsed.severity,
    status: parsed.status,
    occurredAt: parsed.occurredAt,
    reportedByUserId: parsed.reportedByUserId ?? ctx.userId,
    assignedToUserId: parsed.assignedToUserId ?? null,
    resolutionNotes: parsed.resolutionNotes ?? null,
    version: 1,
    syncStatus: "pending",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    createdBy: ctx.userId,
    updatedBy: ctx.userId,
  };

  await db.transaction("rw", db.occurrences, db.outbox, async () => {
    await db.occurrences.add(entity);
    await enqueueOperation(db, {
      companyId: ctx.companyId,
      eventId: parsed.eventId,
      entityType: "Occurrence",
      entityId: id,
      operationType: "CREATE",
      payload: entity as unknown as Record<string, unknown>,
      currentVersion: null,
      deviceId: ctx.deviceId,
    });
  });

  return entity;
}

export async function updateOccurrenceStatus(
  id: string,
  status: LocalOccurrence["status"],
  ctx: RepositoryContext,
  resolutionNotes?: string
): Promise<LocalOccurrence> {
  const db = getDb();

  return db.transaction("rw", db.occurrences, db.outbox, async () => {
    const existing = await db.occurrences.get(id);
    if (!existing || existing.deletedAt) {
      throw new Error("Ocorrência não encontrada localmente.");
    }

    const merged: LocalOccurrence = {
      ...existing,
      status,
      resolutionNotes: resolutionNotes ?? existing.resolutionNotes,
      updatedAt: new Date().toISOString(),
      updatedBy: ctx.userId,
      syncStatus: "pending",
    };

    await db.occurrences.put(merged);
    await enqueueOperation(db, {
      companyId: existing.companyId,
      eventId: existing.eventId,
      entityType: "Occurrence",
      entityId: id,
      operationType: "UPDATE",
      payload: merged as unknown as Record<string, unknown>,
      currentVersion: existing.version,
      deviceId: ctx.deviceId,
    });

    return merged;
  });
}

async function sha256Hex(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Anexa uma evidência (foto/documento) a uma ocorrência. O arquivo em si
 * (`blob`) fica só no dispositivo nesta fatia — sincronizamos apenas os
 * metadados (nome, tipo, tamanho, checksum, data de captura) para o servidor
 * auditar que a evidência existe. Upload real do binário é um adaptador
 * futuro explícito (fora deste slice); nunca fingimos que o upload aconteceu.
 */
export async function addOccurrenceEvidence(
  occurrenceId: string,
  file: { blob: Blob; fileName: string; mimeType: string; kind?: "PHOTO" | "DOCUMENT" | "AUDIO" },
  ctx: RepositoryContext
): Promise<LocalOccurrenceEvidence> {
  const db = getDb();
  const occurrence = await db.occurrences.get(occurrenceId);
  if (!occurrence || occurrence.deletedAt) {
    throw new Error("Ocorrência não encontrada localmente.");
  }

  const checksumSha256 = await sha256Hex(file.blob);
  const id = generateEntityId();
  const now = new Date().toISOString();

  const entity: LocalOccurrenceEvidence = {
    id,
    companyId: occurrence.companyId,
    eventId: occurrence.eventId,
    occurrenceId,
    kind: file.kind ?? "PHOTO",
    fileName: file.fileName,
    mimeType: file.mimeType,
    sizeBytes: file.blob.size,
    storageKey: null,
    checksumSha256,
    capturedAt: now,
    uploadedAt: null,
    version: 1,
    syncStatus: "pending",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    createdBy: ctx.userId,
    updatedBy: ctx.userId,
  };

  await db.transaction("rw", db.occurrenceEvidence, db.evidenceBlobs, db.outbox, async () => {
    await db.occurrenceEvidence.add(entity);
    await db.evidenceBlobs.add({ id, blob: file.blob });
    await enqueueOperation(db, {
      companyId: occurrence.companyId,
      eventId: occurrence.eventId,
      entityType: "OccurrenceEvidence",
      entityId: id,
      operationType: "CREATE",
      // payload sem o blob — a outbox só carrega metadados serializáveis.
      payload: { ...entity },
      currentVersion: null,
      deviceId: ctx.deviceId,
    });
  });

  return entity;
}

export async function listOccurrencesByEvent(eventId: string): Promise<LocalOccurrence[]> {
  const db = getDb();
  const rows = await db.occurrences.where("eventId").equals(eventId).toArray();
  return rows.filter((o) => !o.deletedAt).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
}

export async function listOccurrenceEvidence(
  occurrenceId: string
): Promise<LocalOccurrenceEvidence[]> {
  const db = getDb();
  const rows = await db.occurrenceEvidence.where("occurrenceId").equals(occurrenceId).toArray();
  return rows.filter((e) => !e.deletedAt);
}
