import { prisma } from "@/lib/db/prisma";
import { Prisma, type Client } from "@/generated/prisma/client";
import { OPEN_STAGES, formatDocument, onlyDigits } from "@/lib/domain/crm";
import type { ClientInput, ClientUpdateInput } from "@/lib/domain/crm.schema";
import { AdminActionError } from "@/server/errors";
import { lockClient, requireCrm } from "./access";

const LIST_LIMIT = 200;

export interface ClientListRow {
  id: string;
  name: string;
  kind: "COMPANY" | "PERSON";
  document: string | null;
  email: string | null;
  phone: string | null;
  archived: boolean;
  openOpportunities: number;
}

/** O cliente que a pessoa procura: só desta empresa. Outra empresa é "não existe". */
async function loadClient(companyId: string, clientId: string): Promise<Client> {
  const client = await prisma.client.findFirst({ where: { id: clientId, companyId } });
  if (!client) throw new AdminActionError("Cliente não encontrado.", 404);
  return client;
}

function snapshot(client: Client) {
  return {
    name: client.name,
    kind: client.kind,
    document: client.document,
    email: client.email,
    phone: client.phone,
    notes: client.notes,
    archived: client.archivedAt !== null,
  };
}

/** Mensagem de "documento já cadastrado", dizendo QUEM é (e se está arquivado) para a pessoa achar o cadastro certo. */
async function duplicateDocumentError(companyId: string, document: string): Promise<AdminActionError> {
  const existing = await prisma.client.findFirst({ where: { companyId, document }, select: { name: true, archivedAt: true } });
  const who = existing ? `${existing.name}${existing.archivedAt ? " (arquivado — reative-o em vez de cadastrar de novo)" : ""}` : "outro cliente";
  return new AdminActionError(`O documento ${formatDocument(document)} já está cadastrado para ${who}.`, 409);
}

/**
 * Os clientes da empresa, por nome. `search` procura no nome, no e-mail e no documento (com ou sem
 * máscara). Arquivados só aparecem se pedidos. No máximo 200: a tela mostra que há mais.
 */
export async function listClients(params: {
  userId: string;
  companyId: string;
  search?: string;
  includeArchived?: boolean;
}): Promise<{ rows: ClientListRow[]; truncated: boolean }> {
  await requireCrm(params.userId, params.companyId);

  const term = params.search?.trim();
  const digits = term ? onlyDigits(term) : "";
  const where: Prisma.ClientWhereInput = {
    companyId: params.companyId,
    ...(params.includeArchived ? {} : { archivedAt: null }),
    ...(term
      ? {
          OR: [
            { name: { contains: term, mode: "insensitive" } },
            { email: { contains: term, mode: "insensitive" } },
            ...(digits.length >= 3 ? [{ document: { contains: digits } }] : []),
          ],
        }
      : {}),
  };

  const rows = await prisma.client.findMany({
    where,
    orderBy: { name: "asc" },
    take: LIST_LIMIT + 1,
    include: { _count: { select: { opportunities: { where: { stage: { in: [...OPEN_STAGES] } } } } } },
  });

  return {
    truncated: rows.length > LIST_LIMIT,
    rows: rows.slice(0, LIST_LIMIT).map((c) => ({
      id: c.id,
      name: c.name,
      kind: c.kind,
      document: c.document,
      email: c.email,
      phone: c.phone,
      archived: c.archivedAt !== null,
      openOpportunities: c._count.opportunities,
    })),
  };
}

/** Os clientes ativos para escolher numa oportunidade (id e nome). */
export async function listClientOptions(params: { userId: string; companyId: string }) {
  await requireCrm(params.userId, params.companyId);
  return prisma.client.findMany({
    where: { companyId: params.companyId, archivedAt: null },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
    take: 500,
  });
}

/** Um cliente com as oportunidades dele (das mais novas às mais antigas). */
export async function getClient(params: { userId: string; companyId: string; clientId: string }) {
  await requireCrm(params.userId, params.companyId);
  const client = await loadClient(params.companyId, params.clientId);
  const opportunities = await prisma.opportunity.findMany({
    where: { clientId: client.id, companyId: params.companyId },
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true, stage: true, expectedValueCents: true, eventId: true },
  });
  return { client, opportunities };
}

export async function createClient(params: { userId: string; companyId: string; input: ClientInput }): Promise<Client> {
  await requireCrm(params.userId, params.companyId);

  try {
    return await prisma.$transaction(async (tx) => {
      const client = await tx.client.create({
        data: { ...params.input, companyId: params.companyId, createdBy: params.userId, updatedBy: params.userId },
      });
      await tx.auditLog.create({
        data: {
          companyId: params.companyId,
          userId: params.userId,
          entityType: "Client",
          entityId: client.id,
          action: "CLIENT_CREATED",
          afterJson: snapshot(client),
        },
      });
      return client;
    });
  } catch (err) {
    // Dois cadastros do mesmo documento (ou um duplicado): a chave única é quem decide, sem corrida.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002" && params.input.document) {
      throw await duplicateDocumentError(params.companyId, params.input.document);
    }
    throw err;
  }
}

/**
 * Edita o cadastro. Controle otimista: `baseVersion` precisa ser a versão atual, senão 409 — duas
 * pessoas editando o mesmo cliente nunca se sobrescrevem em silêncio. Arquivado não se edita
 * (reative antes).
 */
export async function updateClient(params: {
  userId: string;
  companyId: string;
  clientId: string;
  input: ClientUpdateInput;
}): Promise<Client> {
  await requireCrm(params.userId, params.companyId);
  const { baseVersion, ...fields } = params.input;

  try {
    return await prisma.$transaction(async (tx) => {
      const current = await tx.client.findFirst({ where: { id: params.clientId, companyId: params.companyId } });
      if (!current) throw new AdminActionError("Cliente não encontrado.", 404);
      if (current.archivedAt) throw new AdminActionError("Este cliente está arquivado. Reative-o para editar.", 409);

      const written = await tx.client.updateMany({
        where: { id: current.id, companyId: params.companyId, version: baseVersion },
        data: { ...fields, updatedBy: params.userId, version: { increment: 1 } },
      });
      if (written.count === 0) {
        throw new AdminActionError(
          "Este cliente foi alterado por outra pessoa enquanto você editava. Recarregue para ver os dados atuais.",
          409
        );
      }

      const updated = await tx.client.findUniqueOrThrow({ where: { id: current.id } });
      await tx.auditLog.create({
        data: {
          companyId: params.companyId,
          userId: params.userId,
          entityType: "Client",
          entityId: current.id,
          action: "CLIENT_UPDATED",
          beforeJson: snapshot(current),
          afterJson: snapshot(updated),
        },
      });
      return updated;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002" && fields.document) {
      throw await duplicateDocumentError(params.companyId, fields.document);
    }
    throw err;
  }
}

/**
 * Arquiva ou reativa um cliente (ele nunca é apagado: o histórico das oportunidades continua
 * legível). Arquivar é recusado enquanto houver oportunidade EM ANDAMENTO — com a linha do cliente
 * travada, para que abrir uma oportunidade ao mesmo tempo não escape da conferência.
 */
export async function setClientArchived(params: {
  userId: string;
  companyId: string;
  clientId: string;
  archived: boolean;
  baseVersion: number;
}): Promise<Client> {
  await requireCrm(params.userId, params.companyId);

  return prisma.$transaction(async (tx) => {
    await lockClient(tx, params.clientId);
    const current = await tx.client.findFirst({ where: { id: params.clientId, companyId: params.companyId } });
    if (!current) throw new AdminActionError("Cliente não encontrado.", 404);
    if (current.version !== params.baseVersion) {
      throw new AdminActionError(
        "Este cliente foi alterado por outra pessoa enquanto você olhava. Recarregue para ver os dados atuais.",
        409
      );
    }
    if (params.archived === (current.archivedAt !== null)) {
      throw new AdminActionError(params.archived ? "Este cliente já está arquivado." : "Este cliente não está arquivado.", 409);
    }

    if (params.archived) {
      const open = await tx.opportunity.count({
        where: { clientId: current.id, stage: { in: [...OPEN_STAGES] } },
      });
      if (open > 0) {
        throw new AdminActionError(
          `Este cliente tem ${open} oportunidade${open > 1 ? "s" : ""} em andamento. Conclua-${open > 1 ? "as" : "a"} (ganha ou perdida) antes de arquivar.`,
          409
        );
      }
    }

    const updated = await tx.client.update({
      where: { id: current.id },
      data: { archivedAt: params.archived ? new Date() : null, updatedBy: params.userId, version: { increment: 1 } },
    });
    await tx.auditLog.create({
      data: {
        companyId: params.companyId,
        userId: params.userId,
        entityType: "Client",
        entityId: current.id,
        action: params.archived ? "CLIENT_ARCHIVED" : "CLIENT_RESTORED",
        beforeJson: snapshot(current),
        afterJson: snapshot(updated),
      },
    });
    return updated;
  });
}
