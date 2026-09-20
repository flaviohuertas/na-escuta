import type { AppDatabase, OfflineSession, OutboxOperation } from "@/lib/db/dexie/db";

/**
 * Fixtures do IndexedDB (fake-indexeddb) para os testes de "acesso retirado / aparelho revogado".
 * Os ids derivam de uma `tag` por evento, então dois eventos no mesmo banco nunca colidem.
 */

export const NOW = "2026-09-19T10:00:00.000Z";
export const COMPANY = "01991b1a-0000-7000-8000-000000000099";

const sync = { version: 1, syncStatus: "synced" as const, createdAt: NOW, updatedAt: NOW, deletedAt: null, createdBy: null, updatedBy: null };

/** Tudo o que um evento preparado tem no aparelho. */
export async function seedEvent(db: AppDatabase, eventId: string, tag: string) {
  await db.events.put({
    id: eventId, companyId: COMPANY, name: `Evento ${tag}`, description: null, location: null,
    startDate: NOW, endDate: NOW, status: "CONFIRMED", ...sync,
  });
  await db.syncState.put({ key: eventId, cursor: "cursor-antigo", lastSyncAt: NOW, lastFullBootstrapAt: NOW, expectedCounts: { Task: 1 } });
  await db.tasks.put({
    id: `${tag}-task`, eventId, companyId: COMPANY, title: "Tarefa", description: null, status: "TODO",
    priority: 0, dueAt: null, assignedToUserId: null, ...sync,
  });
  await db.checklists.put({ id: `${tag}-checklist`, eventId, companyId: COMPANY, title: "Checklist", description: null, ...sync });
  await db.checklistItems.put({
    id: `${tag}-item`, checklistId: `${tag}-checklist`, eventId, companyId: COMPANY, label: "Item", order: 0,
    isRequired: true, status: "PENDING", doneAt: null, doneByUserId: null, ...sync,
  });
  await db.occurrences.put({
    id: `${tag}-occurrence`, eventId, companyId: COMPANY, title: "Ocorrência", description: null, category: null,
    severity: "LOW", status: "OPEN", occurredAt: NOW, reportedByUserId: null, assignedToUserId: null, resolutionNotes: null, ...sync,
  });
  await db.conflicts.put({
    id: `${tag}-conflict`, entityType: "Task", entityId: `${tag}-task`, eventId, baseVersion: 1, serverVersion: 2,
    clientPayload: {}, serverPayload: {}, operationId: `${tag}-op-conflict`, status: "PENDING", detectedAt: NOW, resolvedAt: null,
  });
}

/** Uma evidência da ocorrência do evento; `withFile` = o binário está guardado neste aparelho. */
export async function addEvidence(db: AppDatabase, eventId: string, tag: string, opts: { withFile: boolean; suffix?: string }) {
  const id = `${tag}-evidence${opts.suffix ?? ""}`;
  await db.occurrenceEvidence.put({
    id, occurrenceId: `${tag}-occurrence`, eventId, companyId: COMPANY, kind: "PHOTO",
    fileName: "foto.jpg", mimeType: "image/jpeg", sizeBytes: 4, storageKey: null, checksumSha256: "abc",
    capturedAt: NOW, uploadedAt: opts.withFile ? null : NOW, ...sync,
  });
  if (opts.withFile) await db.evidenceBlobs.put({ id, blob: new Blob(["foto"], { type: "image/jpeg" }) });
  return id;
}

/** Uma operação da outbox (por padrão, `PENDING`, ainda não enviada). */
export function op(eventId: string, id: string, overrides: Partial<OutboxOperation> = {}): OutboxOperation {
  return {
    id, companyId: COMPANY, eventId, entityType: "Task", entityId: `${id}-entity`, operationType: "CREATE",
    payload: { title: `Pendente ${id}` }, baseVersion: null, status: "PENDING", attempts: 0, lastAttemptAt: null,
    nextAttemptAt: NOW, lastError: null, createdAt: NOW, deviceId: "device-1", ...overrides,
  };
}

/** O grant offline guardado no aparelho. */
export function grant(overrides: Partial<OfflineSession> = {}): OfflineSession {
  return {
    key: "current",
    userId: "01991b1a-0000-7000-8000-000000000001",
    companyId: COMPANY,
    deviceId: "device-1",
    issuedAt: NOW,
    expiresAt: "2026-09-26T10:00:00.000Z",
    permissionsSnapshot: { companyRole: "STAFF", eventAccess: [] },
    jwt: "jwt-do-grant",
    lastVerifiedServerTime: NOW,
    monotonicAnchorMs: 0,
    ...overrides,
  };
}

/** Quantas linhas restam, por tabela, de um evento. */
export async function rowsOf(db: AppDatabase, eventId: string, tag: string) {
  return {
    event: await db.events.where("id").equals(eventId).count(),
    tasks: await db.tasks.where("eventId").equals(eventId).count(),
    checklists: await db.checklists.where("eventId").equals(eventId).count(),
    items: await db.checklistItems.where("eventId").equals(eventId).count(),
    occurrences: await db.occurrences.where("eventId").equals(eventId).count(),
    evidence: await db.occurrenceEvidence.where("eventId").equals(eventId).count(),
    blobs: await db.evidenceBlobs.where("id").equals(`${tag}-evidence`).count(),
    conflicts: await db.conflicts.filter((c) => c.eventId === eventId).count(),
    outbox: await db.outbox.where("eventId").equals(eventId).count(),
  };
}

export const NOTHING_LEFT = { event: 0, tasks: 0, checklists: 0, items: 0, occurrences: 0, evidence: 0, blobs: 0, conflicts: 0, outbox: 0 };
