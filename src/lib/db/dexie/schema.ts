import Dexie, { type EntityTable } from "dexie";

export type SyncStatus =
  | "offline"
  | "pending"
  | "syncing"
  | "synced"
  | "conflict"
  | "error";

interface LocalSyncFields {
  version: number;
  syncStatus: SyncStatus;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface LocalEvent extends LocalSyncFields {
  id: string;
  companyId: string;
  name: string;
  description: string | null;
  location: string | null;
  startDate: string;
  endDate: string;
  status: string;
}

export interface LocalTask extends LocalSyncFields {
  id: string;
  eventId: string;
  companyId: string;
  title: string;
  description: string | null;
  status: "TODO" | "IN_PROGRESS" | "DONE" | "BLOCKED";
  priority: number;
  dueAt: string | null;
  assignedToUserId: string | null;
}

export interface LocalChecklistTemplate extends LocalSyncFields {
  id: string;
  eventId: string;
  companyId: string;
  title: string;
  description: string | null;
}

export interface LocalChecklistItem extends LocalSyncFields {
  id: string;
  checklistId: string;
  eventId: string;
  companyId: string;
  label: string;
  order: number;
  isRequired: boolean;
  status: "PENDING" | "DONE" | "NOT_APPLICABLE";
  doneAt: string | null;
  doneByUserId: string | null;
}

export interface LocalOccurrence extends LocalSyncFields {
  id: string;
  eventId: string;
  companyId: string;
  title: string;
  description: string | null;
  category: string | null;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  status: "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";
  occurredAt: string;
  reportedByUserId: string | null;
  assignedToUserId: string | null;
  resolutionNotes: string | null;
}

export interface LocalOccurrenceEvidence extends LocalSyncFields {
  id: string;
  occurrenceId: string;
  eventId: string;
  companyId: string;
  kind: "PHOTO" | "DOCUMENT" | "AUDIO";
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string | null;
  checksumSha256: string;
  capturedAt: string;
  uploadedAt: string | null;
}

/** Blob binário separado da entidade — evita carregar bytes de foto em toda leitura de lista. */
export interface LocalEvidenceBlob {
  id: string; // = OccurrenceEvidence.id
  blob: Blob;
}

export type OutboxEntityType =
  | "Task"
  | "ChecklistTemplate"
  | "ChecklistItem"
  | "Occurrence"
  | "OccurrenceEvidence";

export type OutboxOperationType = "CREATE" | "UPDATE" | "DELETE";
export type OutboxStatus = "PENDING" | "SENDING" | "SENT" | "FAILED" | "CONFLICT";

export interface OutboxOperation {
  id: string; // UUIDv7, chave de idempotência
  companyId: string;
  eventId: string;
  entityType: OutboxEntityType;
  entityId: string;
  operationType: OutboxOperationType;
  payload: Record<string, unknown>;
  baseVersion: number | null;
  status: OutboxStatus;
  attempts: number;
  lastAttemptAt: string | null;
  nextAttemptAt: string;
  lastError: string | null;
  createdAt: string;
  deviceId: string;
}

export interface SyncCursor {
  key: string; // eventId
  cursor: string | null; // null = nunca sincronizado (precisa bootstrap)
  lastSyncAt: string | null;
  lastFullBootstrapAt: string | null;
  expectedCounts: Record<string, number> | null;
  /**
   * O servidor recusou o acesso a este evento (ver `markAccessRevoked`). Some sozinho quando um
   * pull volta a funcionar: os gravadores deste registro não reescrevem estes campos.
   */
  accessRevokedAt?: string | null;
  accessRevokedReason?: string | null;
}

export interface OfflineSession {
  key: "current";
  userId: string;
  companyId: string;
  deviceId: string;
  issuedAt: string;
  expiresAt: string;
  permissionsSnapshot: {
    companyRole: string;
    eventAccess: Array<{ eventId: string; role: string }>;
  };
  jwt: string;
  lastVerifiedServerTime: string;
  monotonicAnchorMs: number;
}

/**
 * O servidor disse que ESTE APARELHO perdeu o acesso (vínculo encerrado, conta desativada,
 * dispositivo revogado) e o aparelho se limpou (`purgeDeviceData`). Fica aqui, até a pessoa
 * decidir o que fazer com o que sobrou, para a tela explicar o que houve em qualquer página —
 * inclusive a de login, que é onde quem perdeu o vínculo cai.
 */
export interface DeviceRevocation {
  key: "revocation";
  revokedAt: string;
  reason: string | null;
  /** De quem eram os dados (o dono do grant que foi julgado). */
  userId: string | null;
}

export type ConflictStatus = "PENDING" | "RESOLVED";

export interface LocalConflict {
  id: string;
  entityType: OutboxEntityType;
  entityId: string;
  eventId: string;
  baseVersion: number;
  serverVersion: number;
  clientPayload: Record<string, unknown>;
  serverPayload: Record<string, unknown>;
  operationId: string;
  status: ConflictStatus;
  detectedAt: string;
  resolvedAt: string | null;
}

export class AppDatabase extends Dexie {
  events!: EntityTable<LocalEvent, "id">;
  tasks!: EntityTable<LocalTask, "id">;
  checklists!: EntityTable<LocalChecklistTemplate, "id">;
  checklistItems!: EntityTable<LocalChecklistItem, "id">;
  occurrences!: EntityTable<LocalOccurrence, "id">;
  occurrenceEvidence!: EntityTable<LocalOccurrenceEvidence, "id">;
  evidenceBlobs!: EntityTable<LocalEvidenceBlob, "id">;
  outbox!: EntityTable<OutboxOperation, "id">;
  syncState!: EntityTable<SyncCursor, "key">;
  session!: EntityTable<OfflineSession, "key">;
  conflicts!: EntityTable<LocalConflict, "id">;
  deviceState!: EntityTable<DeviceRevocation, "key">;

  constructor() {
    super("na-escuta");

    this.version(1).stores({
      events: "id, companyId, updatedAt, syncStatus, deletedAt",
      tasks: "id, eventId, companyId, status, updatedAt, syncStatus, deletedAt, assignedToUserId",
      checklists: "id, eventId, companyId, updatedAt, syncStatus, deletedAt",
      checklistItems:
        "id, checklistId, eventId, companyId, status, updatedAt, syncStatus, deletedAt",
      occurrences: "id, eventId, companyId, status, severity, updatedAt, syncStatus, deletedAt",
      occurrenceEvidence: "id, occurrenceId, eventId, companyId, updatedAt, syncStatus, deletedAt",
      evidenceBlobs: "id",
      outbox: "id, entityId, [entityType+entityId], status, eventId, nextAttemptAt, createdAt",
      syncState: "key",
      session: "key",
      conflicts: "id, entityType, entityId, status, detectedAt",
    });

    // v2: só ACRESCENTA a tabela do aviso de aparelho revogado. As tabelas da v1 seguem como estão
    // (o Dexie as herda) e os dados de quem já usa o app sobrevivem ao upgrade — há teste.
    this.version(2).stores({
      deviceState: "key",
    });
  }
}
