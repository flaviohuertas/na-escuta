import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";
import type { PushOperation, PushResultItem, RejectionReason, SyncOutcome } from "@/lib/sync/protocol";
import { authorizeEventAccess, roleCanWrite } from "./authorize";
import { delegateFor } from "./entity-delegate";
import { SCHEMA_BY_ENTITY } from "./entity-schemas";

interface PushProcessContext {
  userId: string;
}

async function logOutcome(
  tx: Prisma.TransactionClient,
  op: PushOperation,
  ctx: PushProcessContext,
  outcome: SyncOutcome,
  resultVersion?: number,
  errorMessage?: string
): Promise<void> {
  await tx.syncOutboxLog.upsert({
    where: { id: op.id },
    create: {
      id: op.id,
      companyId: op.companyId,
      eventId: op.eventId,
      userId: ctx.userId,
      deviceId: op.deviceId,
      entityType: op.entityType,
      entityId: op.entityId,
      operationType: op.operationType,
      outcome,
      resultVersion,
      errorMessage,
      appliedAt: outcome === "APPLIED" ? new Date() : undefined,
    },
    update: {},
  });
}

function rejected(op: PushOperation, reason: RejectionReason): PushResultItem {
  return { operationId: op.id, entityId: op.entityId, outcome: "REJECTED", rejectionReason: reason };
}

/**
 * Processa uma única operação de push. Idempotência: se `SyncOutboxLog.id`
 * (= operationId do cliente) já existe, retorna o resultado já registrado —
 * reenviar nunca duplica o efeito. Toda a aplicação (checagem de versão,
 * escrita, log de auditoria, log de sync) acontece em UMA transação.
 */
export async function processPushOperation(
  op: PushOperation,
  ctx: PushProcessContext
): Promise<PushResultItem> {
  const existingLog = await prisma.syncOutboxLog.findUnique({ where: { id: op.id } });
  if (existingLog) {
    return {
      operationId: op.id,
      entityId: op.entityId,
      outcome: "DUPLICATE_IGNORED",
      serverVersion: existingLog.resultVersion ?? undefined,
    };
  }

  const auth = await authorizeEventAccess({ userId: ctx.userId }, op.eventId);
  if (!auth.allowed || !auth.companyId) {
    return rejected(op, auth.reason ?? "FORBIDDEN");
  }
  if (!auth.eventRole || !roleCanWrite(auth.eventRole)) {
    return rejected(op, "FORBIDDEN");
  }

  const schema = SCHEMA_BY_ENTITY[op.entityType];
  let parsedPayload: Record<string, unknown> | undefined;
  if (op.operationType !== "DELETE") {
    const result = schema.safeParse(op.payload);
    if (!result.success) return rejected(op, "VALIDATION_ERROR");
    parsedPayload = result.data as Record<string, unknown>;
  }

  return prisma.$transaction(async (tx) => {
    const delegate = delegateFor(tx, op.entityType);

    if (op.operationType === "CREATE") {
      const created = await delegate.create({
        data: {
          id: op.entityId,
          companyId: auth.companyId,
          ...parsedPayload,
          version: 1,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        },
      });
      await tx.auditLog.create({
        data: {
          companyId: auth.companyId!,
          eventId: op.eventId,
          userId: ctx.userId,
          entityType: op.entityType,
          entityId: op.entityId,
          action: "CREATE",
          afterJson: created,
          metadata: { syncOperationId: op.id, deviceId: op.deviceId },
        },
      });
      await logOutcome(tx, op, ctx, "APPLIED", created.version);
      return {
        operationId: op.id,
        entityId: op.entityId,
        outcome: "APPLIED" as const,
        serverVersion: created.version,
        serverEntity: created,
      };
    }

    const current = await delegate.findUnique({ where: { id: op.entityId } });
    if (!current || current.deletedAt) {
      await logOutcome(tx, op, ctx, "REJECTED", undefined, "ENTITY_NOT_FOUND");
      return rejected(op, "ENTITY_NOT_FOUND");
    }

    if (current.version !== op.baseVersion) {
      const conflict = await tx.conflict.create({
        data: {
          entityType: op.entityType,
          entityId: op.entityId,
          companyId: auth.companyId!,
          eventId: op.eventId,
          baseVersion: op.baseVersion ?? 0,
          serverVersion: current.version,
          clientPayload: op.payload as Prisma.InputJsonValue,
          serverPayload: current as Prisma.InputJsonValue,
          deviceId: op.deviceId,
          operationId: op.id,
        },
      });
      await logOutcome(tx, op, ctx, "CONFLICT", current.version);
      return {
        operationId: op.id,
        entityId: op.entityId,
        outcome: "CONFLICT" as const,
        conflictId: conflict.id,
        serverVersion: current.version,
        serverEntity: current,
      };
    }

    if (op.operationType === "DELETE") {
      const updated = await delegate.update({
        where: { id: op.entityId },
        data: { deletedAt: new Date(), updatedBy: ctx.userId, version: { increment: 1 } },
      });
      await tx.auditLog.create({
        data: {
          companyId: auth.companyId!,
          eventId: op.eventId,
          userId: ctx.userId,
          entityType: op.entityType,
          entityId: op.entityId,
          action: "DELETE",
          beforeJson: current,
          metadata: { syncOperationId: op.id, deviceId: op.deviceId },
        },
      });
      await logOutcome(tx, op, ctx, "APPLIED", updated.version);
      return {
        operationId: op.id,
        entityId: op.entityId,
        outcome: "APPLIED" as const,
        serverVersion: updated.version,
      };
    }

    // UPDATE
    const updated = await delegate.update({
      where: { id: op.entityId },
      data: { ...parsedPayload, updatedBy: ctx.userId, version: { increment: 1 } },
    });
    await tx.auditLog.create({
      data: {
        companyId: auth.companyId!,
        eventId: op.eventId,
        userId: ctx.userId,
        entityType: op.entityType,
        entityId: op.entityId,
        action: "UPDATE",
        beforeJson: current,
        afterJson: updated,
        metadata: { syncOperationId: op.id, deviceId: op.deviceId },
      },
    });
    await logOutcome(tx, op, ctx, "APPLIED", updated.version);
    return {
      operationId: op.id,
      entityId: op.entityId,
      outcome: "APPLIED" as const,
      serverVersion: updated.version,
      serverEntity: updated,
    };
  });
}

export async function processPushBatch(
  operations: PushOperation[],
  ctx: PushProcessContext
): Promise<PushResultItem[]> {
  const results: PushResultItem[] = [];
  // Sequencial (não Promise.all): operações da mesma entidade precisam ser
  // aplicadas em ordem, e o volume por lote (≤200) não justifica o risco de
  // paralelizar escritas conflitantes no mesmo request.
  for (const op of operations) {
    results.push(await processPushOperation(op, ctx));
  }
  return results;
}
