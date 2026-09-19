import { prisma } from "@/lib/db/prisma";
import type { PullChange, PullResponse, SyncEntityType } from "@/lib/sync/protocol";
import { authorizeEventAccess } from "./authorize";
import { delegateFor } from "./entity-delegate";
import { toEventSnapshot } from "./event-snapshot";

const PER_TYPE_PAGE_SIZE = 40;

const ENTITY_TYPES: SyncEntityType[] = [
  "Task",
  "ChecklistTemplate",
  "ChecklistItem",
  "Occurrence",
  "OccurrenceEvidence",
];

interface EntityCursor {
  updatedAt: string;
  id: string;
}
type CursorMap = Partial<Record<SyncEntityType, EntityCursor>>;

function decodeCursor(cursor: string | null): CursorMap {
  if (!cursor) return {};
  try {
    return JSON.parse(Buffer.from(cursor, "base64url").toString("utf-8"));
  } catch {
    return {};
  }
}

function encodeCursor(map: CursorMap): string {
  return Buffer.from(JSON.stringify(map), "utf-8").toString("base64url");
}

interface PullContext {
  userId: string;
}

/**
 * Keyset pagination por tipo de entidade: o cursor opaco guarda, para cada
 * um dos 5 tipos, o último `(updatedAt, id)` já entregue. Cada página busca
 * `WHERE eventId = ? AND (updatedAt, id) > cursor` (emulado com OR, já que o
 * Prisma não expõe comparação de tupla nativa) — evita reenviar tudo a cada
 * sync e nunca pula registros mesmo com updatedAt empatado.
 */
export async function pullChangesForEvent(
  eventId: string,
  cursorParam: string | null,
  ctx: PullContext
): Promise<PullResponse> {
  const auth = await authorizeEventAccess({ userId: ctx.userId }, eventId);
  if (!auth.allowed) {
    return {
      changes: [],
      nextCursor: cursorParam ?? encodeCursor({}),
      hasMore: false,
      serverTime: new Date().toISOString(),
      accessRevoked: true,
      revokedReason: auth.reason,
    };
  }

  const cursorMap = decodeCursor(cursorParam);
  const changes: PullChange[] = [];
  const nextCursorMap: CursorMap = { ...cursorMap };
  let hasMore = false;

  for (const entityType of ENTITY_TYPES) {
    const cursor = cursorMap[entityType];
    const delegate = delegateFor(prisma, entityType);

    const where: Record<string, unknown> = { eventId };
    if (cursor) {
      where.OR = [
        { updatedAt: { gt: new Date(cursor.updatedAt) } },
        { updatedAt: new Date(cursor.updatedAt), id: { gt: cursor.id } },
      ];
    }

    const rows: any[] = await delegate.findMany({
      where,
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: PER_TYPE_PAGE_SIZE,
    });

    for (const row of rows) {
      changes.push({
        entityType,
        entityId: row.id,
        version: row.version,
        deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
        data: row.deletedAt ? null : row,
        updatedAt: row.updatedAt.toISOString(),
      });
    }

    if (rows.length > 0) {
      const last = rows[rows.length - 1];
      nextCursorMap[entityType] = { updatedAt: last.updatedAt.toISOString(), id: last.id };
      if (rows.length === PER_TYPE_PAGE_SIZE) hasMore = true;
    }
  }

  // Uma linha por chave primária: barato o bastante para ir em toda página. `authorizeEventAccess`
  // acabou de confirmar que o evento existe e não foi excluído.
  const event = await prisma.event.findUnique({ where: { id: eventId } });

  return {
    changes,
    nextCursor: encodeCursor(nextCursorMap),
    hasMore,
    serverTime: new Date().toISOString(),
    accessRevoked: false,
    event: event ? toEventSnapshot(event) : null,
  };
}
