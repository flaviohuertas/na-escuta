import { prisma } from "@/lib/db/prisma";
import { ConflictResolutionStrategy, ConflictStatus } from "@/generated/prisma/enums";
import { authorizeEventAccess, roleCanWrite } from "./authorize";
import { delegateFor } from "./entity-delegate";
import { SCHEMA_BY_ENTITY } from "./entity-schemas";
import type { SyncEntityType } from "@/lib/sync/protocol";

export class ConflictNotFoundError extends Error {}
export class InvalidConflictPayloadError extends Error {}
export class ConflictAlreadyResolvedError extends Error {
  /**
   * Estado ATUAL da entidade no servidor. Quem tentou resolver de outro dispositivo usa isso
   * para convergir a cópia local em vez de ficar com um conflito que não consegue mais fechar.
   */
  constructor(
    message: string,
    public entity: unknown = null
  ) {
    super(message);
  }
}
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

  // Autorização ANTES de qualquer resposta que revele dado: o 409 abaixo devolve a entidade.
  const auth = await authorizeEventAccess({ userId: params.userId }, conflict.eventId);
  if (!auth.allowed || !auth.eventRole || !roleCanWrite(auth.eventRole)) {
    throw new ConflictForbiddenError(auth.reason ?? "FORBIDDEN");
  }

  const entityType = conflict.entityType as SyncEntityType;

  if (conflict.status === ConflictStatus.RESOLVED) {
    const current = await delegateFor(prisma, entityType).findUnique({
      where: { id: conflict.entityId },
    });
    throw new ConflictAlreadyResolvedError("Este conflito já foi resolvido.", current);
  }

  return prisma.$transaction(async (tx) => {
    const delegate = delegateFor(tx, entityType);

    // "Reivindica" o conflito ANTES de aplicar qualquer coisa. A checagem de RESOLVED lá em cima
    // roda fora da transação: dois dispositivos resolvendo ao mesmo tempo passavam os dois por
    // ela e aplicavam duas vezes (versão +2, e a decisão de um sobrescrevia a do outro). O UPDATE
    // condicional é atômico: o segundo espera o lock da linha, reavalia `status = PENDING` depois
    // do commit do primeiro e não encontra nada. Qualquer erro adiante desfaz a reivindicação.
    const claimed = await tx.conflict.updateMany({
      where: { id: conflict.id, status: ConflictStatus.PENDING },
      data: {
        status: ConflictStatus.RESOLVED,
        resolutionStrategy: ConflictResolutionStrategy[params.strategy],
        resolvedBy: params.userId,
        resolvedAt: new Date(),
        resolutionNotes: params.resolutionNotes,
      },
    });

    const current = await delegate.findUnique({ where: { id: conflict.entityId } });
    if (claimed.count === 0) {
      throw new ConflictAlreadyResolvedError("Este conflito já foi resolvido.", current);
    }
    if (!current) throw new ConflictNotFoundError("A entidade do conflito não existe mais.");

    let updatedEntity = current;

    if (params.strategy !== "KEEP_SERVER") {
      const payload =
        params.strategy === "MERGED" ? params.mergedPayload : asPayloadObject(conflict.clientPayload);
      if (!payload) {
        throw new InvalidConflictPayloadError(
          params.strategy === "MERGED"
            ? "A resolução por mescla exige o conteúdo mesclado (mergedPayload)."
            : "Este conflito não guardou o conteúdo do dispositivo, então não há o que aplicar."
        );
      }
      if (params.strategy === "KEEP_CLIENT" && isDeleteShapedPayload(payload)) {
        throw new InvalidConflictPayloadError(
          "Este conflito veio de uma exclusão feita no dispositivo, e aplicá-la por aqui ainda não é " +
            "possível. Use “Manter o servidor” e, se for o caso, exclua de novo em seguida."
        );
      }
      // O `clientPayload` guardado é o objeto LOCAL do dispositivo, cru (com `syncStatus`,
      // `createdAt` etc.). Passa pelo mesmo schema do push, que descarta o que só existe no
      // dispositivo — aplicar cru falhava no Prisma com "Unknown argument `syncStatus`" e a
      // resolução "Manter minha versão" nunca funcionava.
      const validated = SCHEMA_BY_ENTITY[entityType].safeParse(payload);
      if (!validated.success) {
        throw new InvalidConflictPayloadError(
          "O conteúdo guardado deste conflito não é válido para ser aplicado."
        );
      }
      // Remove campos de identidade/controle que não devem ser sobrescritos por payload de cliente.
      const {
        id: _id,
        version: _v,
        companyId: _c,
        eventId: _e,
        ...safePayload
      } = validated.data as Record<string, unknown>;

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

    return updatedEntity;
  });
}

function asPayloadObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * O `Conflict` não guarda o tipo da operação, mas o cliente emite todo DELETE com o payload
 * `{ id }` (ver `deleteTask`) — nenhum UPDATE/CREATE válido é só isso, pois todos exigem título.
 */
function isDeleteShapedPayload(payload: Record<string, unknown>): boolean {
  const keys = Object.keys(payload);
  return keys.length === 1 && keys[0] === "id";
}

export async function listPendingConflicts(eventId: string, userId: string) {
  const auth = await authorizeEventAccess({ userId }, eventId);
  if (!auth.allowed) throw new ConflictForbiddenError(auth.reason ?? "FORBIDDEN");

  return prisma.conflict.findMany({
    where: { eventId, status: ConflictStatus.PENDING },
    orderBy: { detectedAt: "desc" },
  });
}
