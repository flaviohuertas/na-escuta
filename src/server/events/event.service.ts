import { prisma } from "@/lib/db/prisma";
import type { Event } from "@/generated/prisma/client";
import { EventRole } from "@/generated/prisma/enums";
import type { EventParsed, EventUpdateParsed } from "@/lib/domain/event.schema";
import { canCreateEvents, canManageEvent } from "@/lib/domain/permissions";
import { getActiveCompanyRole } from "@/server/auth/membership";
import { authorizeEventAccess } from "@/server/sync/authorize";

export class EventForbiddenError extends Error {}
export class EventNotFoundError extends Error {}
export class EventVersionConflictError extends Error {
  /** Estado ATUAL do evento, para a tela mostrar o que mudou em vez de só recusar. */
  constructor(
    message: string,
    public current: Event
  ) {
    super(message);
  }
}

const EDITABLE_FIELDS = ["name", "description", "location", "startDate", "endDate", "status"] as const;

function normalize(input: EventParsed) {
  return {
    name: input.name,
    // Campo em branco vira "sem valor" (null), nunca uma string vazia gravada.
    description: input.description?.trim() ? input.description.trim() : null,
    location: input.location?.trim() ? input.location.trim() : null,
    startDate: new Date(input.startDate),
    endDate: new Date(input.endDate),
    status: input.status,
  };
}

/** Só o GESTOR do evento (vínculo ativo na empresa + acesso ativo ao evento, revalidados agora) passa. */
async function requireEventManager(userId: string, eventId: string): Promise<void> {
  const auth = await authorizeEventAccess({ userId }, eventId);
  if (!auth.allowed) {
    if (auth.reason === "ENTITY_NOT_FOUND") throw new EventNotFoundError("Evento não encontrado.");
    throw new EventForbiddenError("Você não tem acesso a este evento.");
  }
  if (!auth.eventRole || !canManageEvent(auth.eventRole)) {
    throw new EventForbiddenError("Só o gestor do evento pode editá-lo.");
  }
}

/**
 * Cria um evento na empresa da pessoa e já a torna GESTORA dele. Só cria quem tem vínculo ATIVO
 * com a empresa e papel de criar eventos — revalidado no banco a cada chamada, porque a sessão
 * (JWT) continua válida depois de uma revogação.
 */
export async function createEvent(params: {
  userId: string;
  companyId: string;
  input: EventParsed;
}): Promise<Event> {
  const role = await getActiveCompanyRole(params.userId, params.companyId);
  if (!role || !canCreateEvents(role)) {
    throw new EventForbiddenError("Você não tem permissão para criar eventos nesta empresa.");
  }

  const data = normalize(params.input);

  return prisma.$transaction(async (tx) => {
    const event = await tx.event.create({
      data: {
        ...data,
        companyId: params.companyId,
        createdBy: params.userId,
        updatedBy: params.userId,
      },
    });
    await tx.eventAccess.create({
      data: { userId: params.userId, eventId: event.id, role: EventRole.MANAGER, grantedBy: params.userId },
    });
    await tx.auditLog.create({
      data: {
        companyId: params.companyId,
        eventId: event.id,
        userId: params.userId,
        entityType: "Event",
        entityId: event.id,
        action: "CREATE",
        afterJson: event,
      },
    });
    return event;
  });
}

/**
 * Edita os dados do evento. Só o GESTOR do evento (com vínculo ativo na empresa e acesso ativo
 * ao evento — `authorizeEventAccess`). Controle otimista: `baseVersion` precisa ser a versão
 * atual, senão 409 com o estado atual — duas pessoas editando ao mesmo tempo nunca se
 * sobrescrevem em silêncio (mesma regra do resto do sistema).
 */
export async function updateEvent(params: {
  userId: string;
  eventId: string;
  input: EventUpdateParsed;
}): Promise<Event> {
  await requireEventManager(params.userId, params.eventId);

  const { baseVersion, ...fields } = params.input;
  const data = normalize(fields);

  return prisma.$transaction(async (tx) => {
    const current = await tx.event.findUnique({ where: { id: params.eventId } });
    if (!current || current.deletedAt) throw new EventNotFoundError("Evento não encontrado.");

    // O que a pessoa quer já é o que está gravado (mesmo que a versão tenha andado): não há o que
    // escrever nem o que sobrescrever. Não sobe a versão — que faria todo aparelho preparado
    // baixar o evento de novo — nem enche o histórico de auditoria.
    const unchanged = EDITABLE_FIELDS.every((field) => {
      const a = current[field];
      const b = data[field];
      return a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b;
    });
    if (unchanged) return current;

    // UPDATE condicional na versão: atômico — o concorrente que chega depois espera o lock da
    // linha, reavalia `version = baseVersion` e não encontra nada.
    const written = await tx.event.updateMany({
      where: { id: params.eventId, version: baseVersion, deletedAt: null },
      data: { ...data, updatedBy: params.userId, version: { increment: 1 } },
    });
    if (written.count === 0) {
      const latest = await tx.event.findUniqueOrThrow({ where: { id: params.eventId } });
      throw new EventVersionConflictError(
        "Este evento foi alterado por outra pessoa enquanto você editava. Confira os dados atuais antes de salvar de novo.",
        latest
      );
    }

    const updated = await tx.event.findUniqueOrThrow({ where: { id: params.eventId } });
    await tx.auditLog.create({
      data: {
        companyId: updated.companyId,
        eventId: updated.id,
        userId: params.userId,
        entityType: "Event",
        entityId: updated.id,
        action: "UPDATE",
        beforeJson: current,
        afterJson: updated,
      },
    });
    return updated;
  });
}

/** O evento para a tela de edição — só para quem pode editá-lo (mesma checagem de `updateEvent`). */
export async function getEventForEditing(params: { userId: string; eventId: string }): Promise<Event> {
  await requireEventManager(params.userId, params.eventId);
  return prisma.event.findUniqueOrThrow({ where: { id: params.eventId } });
}
