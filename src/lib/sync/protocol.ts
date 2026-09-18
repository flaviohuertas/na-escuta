import { z } from "zod";

/**
 * Contrato compartilhado (cliente e servidor) do protocolo de sincronização.
 * Qualquer mudança aqui deve ser compatível nos dois lados ao mesmo tempo.
 */

export const SyncEntityTypeSchema = z.enum([
  "Task",
  "ChecklistTemplate",
  "ChecklistItem",
  "Occurrence",
  "OccurrenceEvidence",
]);
export type SyncEntityType = z.infer<typeof SyncEntityTypeSchema>;

export const SyncOperationTypeSchema = z.enum(["CREATE", "UPDATE", "DELETE"]);
export type SyncOperationType = z.infer<typeof SyncOperationTypeSchema>;

// ---------------------------------------------------------------------------
// Push: cliente envia um lote de operações da outbox
// ---------------------------------------------------------------------------

export const PushOperationSchema = z.object({
  id: z.string().uuid(), // = outbox.id — chave de idempotência
  companyId: z.string().uuid(),
  eventId: z.string().uuid(),
  entityType: SyncEntityTypeSchema,
  entityId: z.string().uuid(),
  operationType: SyncOperationTypeSchema,
  // baseVersion = versão que o cliente tinha quando editou; null só é válido em CREATE.
  baseVersion: z.number().int().positive().nullable(),
  payload: z.record(z.string(), z.unknown()),
  clientTimestamp: z.string().datetime(),
  deviceId: z.string().min(1),
});
export type PushOperation = z.infer<typeof PushOperationSchema>;

export const PushRequestSchema = z.object({
  deviceId: z.string().min(1),
  operations: z.array(PushOperationSchema).min(1).max(200),
});
export type PushRequest = z.infer<typeof PushRequestSchema>;

export const SyncOutcomeSchema = z.enum([
  "APPLIED",
  "CONFLICT",
  "REJECTED",
  "DUPLICATE_IGNORED",
]);
export type SyncOutcome = z.infer<typeof SyncOutcomeSchema>;

export const RejectionReasonSchema = z.enum([
  "MEMBERSHIP_REVOKED",
  "EVENT_ACCESS_REVOKED",
  "FORBIDDEN",
  "VALIDATION_ERROR",
  "ENTITY_NOT_FOUND",
  "SESSION_EXPIRED",
]);
export type RejectionReason = z.infer<typeof RejectionReasonSchema>;

export const PushResultItemSchema = z.object({
  operationId: z.string().uuid(),
  entityId: z.string().uuid(),
  outcome: SyncOutcomeSchema,
  serverVersion: z.number().int().positive().optional(),
  serverEntity: z.record(z.string(), z.unknown()).optional(),
  conflictId: z.string().uuid().optional(),
  rejectionReason: RejectionReasonSchema.optional(),
});
export type PushResultItem = z.infer<typeof PushResultItemSchema>;

export const PushResponseSchema = z.object({
  results: z.array(PushResultItemSchema),
  serverTime: z.string().datetime(),
});
export type PushResponse = z.infer<typeof PushResponseSchema>;

// ---------------------------------------------------------------------------
// Pull: cliente busca mudanças incrementais desde um cursor
// ---------------------------------------------------------------------------

export const PullRequestSchema = z.object({
  eventId: z.string().uuid(),
  cursor: z.string().nullable(),
});
export type PullRequest = z.infer<typeof PullRequestSchema>;

export const PullChangeSchema = z.object({
  entityType: SyncEntityTypeSchema,
  entityId: z.string().uuid(),
  version: z.number().int().positive(),
  deletedAt: z.string().datetime().nullable(),
  data: z.record(z.string(), z.unknown()).nullable(), // null quando deletedAt != null (tombstone)
  updatedAt: z.string().datetime(),
});
export type PullChange = z.infer<typeof PullChangeSchema>;

export const PullResponseSchema = z.object({
  changes: z.array(PullChangeSchema),
  nextCursor: z.string(),
  hasMore: z.boolean(),
  serverTime: z.string().datetime(),
  accessRevoked: z.boolean().default(false),
  revokedReason: z.string().optional(),
});
export type PullResponse = z.infer<typeof PullResponseSchema>;

// ---------------------------------------------------------------------------
// Bootstrap: download inicial completo ao "preparar evento para uso offline"
// ---------------------------------------------------------------------------

export const BootstrapRequestSchema = z.object({
  eventId: z.string().uuid(),
});
export type BootstrapRequest = z.infer<typeof BootstrapRequestSchema>;

export const BootstrapManifestSchema = z.object({
  eventId: z.string().uuid(),
  cursor: z.string(),
  counts: z.record(z.string(), z.number().int().nonnegative()),
  serverTime: z.string().datetime(),
});
export type BootstrapManifest = z.infer<typeof BootstrapManifestSchema>;

/** Evento não é uma entidade sincronizável via outbox nesta fatia (sem edição offline), mas precisa ir junto no bootstrap como referência. */
export const EventSnapshotSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  location: z.string().nullable(),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  status: z.string(),
  version: z.number().int(),
  updatedAt: z.string().datetime(),
});
export type EventSnapshot = z.infer<typeof EventSnapshotSchema>;

export const BootstrapResponseSchema = z.object({
  manifest: BootstrapManifestSchema,
  event: EventSnapshotSchema,
  changes: z.array(PullChangeSchema),
});
export type BootstrapResponse = z.infer<typeof BootstrapResponseSchema>;
