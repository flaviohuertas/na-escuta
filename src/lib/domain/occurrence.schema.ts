import { z } from "zod";
import { SyncMetaSchema, uuid } from "./common.schema";

export const OccurrenceSeverityValues = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export const OccurrenceSeveritySchema = z.enum(OccurrenceSeverityValues);
export type OccurrenceSeverity = z.infer<typeof OccurrenceSeveritySchema>;

export const OccurrenceStatusValues = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"] as const;
export const OccurrenceStatusSchema = z.enum(OccurrenceStatusValues);
export type OccurrenceStatus = z.infer<typeof OccurrenceStatusSchema>;

export const OccurrenceInputSchema = z.object({
  eventId: uuid(),
  title: z.string().trim().min(1, "Informe o título da ocorrência").max(200),
  description: z.string().trim().max(4000).optional().nullable(),
  category: z.string().trim().max(100).optional().nullable(),
  severity: OccurrenceSeveritySchema.default("LOW"),
  status: OccurrenceStatusSchema.default("OPEN"),
  occurredAt: z.string().datetime(),
  reportedByUserId: uuid().optional().nullable(),
  assignedToUserId: uuid().optional().nullable(),
  resolutionNotes: z.string().trim().max(4000).optional().nullable(),
});

export const OccurrenceEntitySchema = z
  .object({ id: uuid(), companyId: uuid() })
  .merge(OccurrenceInputSchema)
  .merge(SyncMetaSchema);

export const EvidenceKindValues = ["PHOTO", "DOCUMENT", "AUDIO"] as const;
export const EvidenceKindSchema = z.enum(EvidenceKindValues);
export type EvidenceKind = z.infer<typeof EvidenceKindSchema>;

export const OccurrenceEvidenceInputSchema = z.object({
  occurrenceId: uuid(),
  eventId: uuid(),
  kind: EvidenceKindSchema.default("PHOTO"),
  fileName: z.string().trim().min(1).max(260),
  mimeType: z.string().trim().min(1).max(120),
  sizeBytes: z.number().int().positive().max(25 * 1024 * 1024, "Arquivo maior que 25MB"),
  checksumSha256: z.string().length(64),
  capturedAt: z.string().datetime(),
});

export const OccurrenceEvidenceEntitySchema = z
  .object({
    id: uuid(),
    companyId: uuid(),
    storageKey: z.string().nullable(),
    uploadedAt: z.string().datetime().nullable(),
  })
  .merge(OccurrenceEvidenceInputSchema)
  .merge(SyncMetaSchema);

export type OccurrenceInput = z.input<typeof OccurrenceInputSchema>;
export type OccurrenceParsed = z.infer<typeof OccurrenceInputSchema>;
export type OccurrenceEntity = z.infer<typeof OccurrenceEntitySchema>;
export type OccurrenceEvidenceInput = z.input<typeof OccurrenceEvidenceInputSchema>;
export type OccurrenceEvidenceParsed = z.infer<typeof OccurrenceEvidenceInputSchema>;
export type OccurrenceEvidenceEntity = z.infer<typeof OccurrenceEvidenceEntitySchema>;
