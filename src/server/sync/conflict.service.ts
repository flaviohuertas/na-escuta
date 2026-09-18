import { prisma } from "@/lib/db/prisma";
import { ConflictResolutionStrategy, ConflictStatus } from "@/generated/prisma/enums";
import { authorizeEventAccess, roleCanWrite } from "./authorize";
import { delegateFor } from "./entity-delegate";
import type { SyncEntityType } from "@/lib/sync/protocol";

export class ConflictNotFoundError extends Error {}
export class ConflictAlreadyResolvedError extends Error {}
export class ConflictForbiddenError extends Error {
  constructor(public reason: string) {
    super(reason);
  }
}

export interface ResolveConflictParams {
  conflictId: string;
  userId: string;
  strategy: "KEEP_SERVER" | "KEEP_CLIENT" | "MERGED";
  mergedPayload?: Record<string, unknown>;
  resolutionNotes?: string;
}

/**
 * Resolução manual e auditada de um conflito. Nunca sobrescreve
 * silenciosamente: quem resolveu, quando e qual estratégia venceu ficam
 * registrados em AuditLog. KEEP_CLIENT e MERGED aplicam a mudança como uma
 * nova escrita normal (incrementa version a partir do estado atual do
 * servidor) — não reabrem a checagem de conflito, porque a pessoa que está
 * resolvendo já viu as duas versões e decidiu conscientemente.
 */
export async function resolveConflict(params: ResolveConflictParams) {
  const conflict = await prisma.conflict.findUnique({ where: { id: params.conflictId } });
  if (!conflict) throw new ConflictNotFoundError("Conflito não encontrado.");
  if (conflict.status === ConflictStatus.RESOLVED) {
    throw new ConflictAlreadyResolvedError("Este conflito já foi resolvido.");
  }

  const auth = await authorizeEventAccess({ userId: params.userId }, conflict.eventId);
  if (!auth.allowed || !auth.eventRole || !roleCanWrite(auth.eventRole)) {
    throw new ConflictForbiddenError(auth.reason ?? "FORBIDDEN");
  }

  const entityType = conflict.entityType as SyncEntityType;

  return prisma.$transaction(async (tx) => {
    const delegate = delegateFor(tx, entityType);
    const current = await delegate.findUnique({ where: { id: conflict.entityId } });
    if (!current) throw new ConflictNotFoundError("A entidade do conflito não existe mais.");

    let updatedEntity = current;

    if (params.strategy !== "KEEP_SERVER") {
      const payload =
        params.strategy === "MERGED"
          ? params.mergedPayload
          : (conflict.clientPayload as Record<string, unknown>);
      if (!payload) {
        throw new Error("MERGED exige mergedPayload.");
      }
      // Remove campos de identidade/controle que não devem ser sobrescritos por payload de cliente.
      const { id: _id, version: _v, companyId: _c, eventId: _e, ...safePayload } = payload as Record<
        string,
        unknown
      >;

      updatedEntity = await delegate.update({
        where: { id: conflict.entityId },
        data: { ...safePayload, updatedBy: params.userId, version: { increment: 1 } },
      });

      await tx.auditLog.create({
        data: {
          companyId: conflict.companyId,
          eventId: conflict.eventId,
          userId: params.userId,
          entityType,
          entityId: conflict.entityId,
          action: "CONFLICT_RESOLVED",
          beforeJson: current,
          afterJson: updatedEntity,
          metadata: { conflictId: conflict.id, strategy: params.strategy },
        },
      });
    } else {
      await tx.auditLog.create({
        data: {
          companyId: conflict.companyId,
          eventId: conflict.eventId,
          userId: params.userId,
          entityType,
          entityId: conflict.entityId,
          action: "CONFLICT_RESOLVED",
          beforeJson: current,
          afterJson: current,
          metadata: { conflictId: conflict.id, strategy: params.strategy },
        },
      });
    }

    await tx.conflict.update({
      where: { id: conflict.id },
      data: {
        status: ConflictStatus.RESOLVED,
        resolutionStrategy: ConflictResolutionStrategy[params.strategy],
        resolvedBy: params.userId,
        resolvedAt: new Date(),
        resolutionNotes: params.resolutionNotes,
      },
    });

    return updatedEntity;
  });
}

export async function listPendingConflicts(eventId: string, userId: string) {
  const auth = await authorizeEventAccess({ userId }, eventId);
  if (!auth.allowed) throw new ConflictForbiddenError(auth.reason ?? "FORBIDDEN");

  return prisma.conflict.findMany({
    where: { eventId, status: ConflictStatus.PENDING },
    orderBy: { detectedAt: "desc" },
  });
}
