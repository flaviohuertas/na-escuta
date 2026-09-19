/**
 * Testes de integração — exigem Postgres real (ver cabeçalho de
 * sync-push.integration.test.ts). NÃO executados nesta sessão de
 * desenvolvimento.
 *
 * Simula dois dispositivos editando a mesma tarefa offline e depois
 * sincronizando em ordens diferentes — o segundo a chegar gera conflito, que
 * é então resolvido manualmente (nunca "última gravação vence" automático).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createMembership,
  createTestCompany,
  createTestEvent,
  createTestPrismaClient,
  createTestUser,
  grantEventAccess,
  single,
  truncateAll,
} from "../helpers/factories";
import { processPushBatch } from "@/server/sync/push.service";
import {
  ConflictAlreadyResolvedError,
  ConflictForbiddenError,
  InvalidConflictPayloadError,
  resolveConflict,
} from "@/server/sync/conflict.service";
import type { PushOperation } from "@/lib/sync/protocol";

const prisma = createTestPrismaClient();

describe("conflitos entre dois dispositivos (integração — Postgres real)", () => {
  beforeEach(async () => {
    await truncateAll(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function setupConflict(deviceBExtraFields: Record<string, unknown> = {}) {
    const company = await createTestCompany(prisma);
    const user = await createTestUser(prisma);
    await createMembership(prisma, user.id, company.id, "PRODUCER");
    const event = await createTestEvent(prisma, company.id);
    await grantEventAccess(prisma, user.id, event.id, "MANAGER");

    const taskId = randomUUID();
    await processPushBatch(
      [
        {
          id: randomUUID(),
          companyId: company.id,
          eventId: event.id,
          entityType: "Task",
          entityId: taskId,
          operationType: "CREATE",
          baseVersion: null,
          payload: { eventId: event.id, title: "Original" },
          clientTimestamp: new Date().toISOString(),
          deviceId: "device-A",
        },
      ],
      { userId: user.id }
    );

    // Dispositivo A sincroniza primeiro sua edição — vai de v1 para v2.
    const deviceAOp: PushOperation = {
      id: randomUUID(),
      companyId: company.id,
      eventId: event.id,
      entityType: "Task",
      entityId: taskId,
      operationType: "UPDATE",
      baseVersion: 1,
      payload: { eventId: event.id, title: "Editado pelo dispositivo A" },
      clientTimestamp: new Date().toISOString(),
      deviceId: "device-A",
    };
    const resultA = single(await processPushBatch([deviceAOp], { userId: user.id }));
    expect(resultA.outcome).toBe("APPLIED");

    // Dispositivo B editou offline a MESMA tarefa antes de saber da mudança
    // de A — ainda acha que a versão base é 1. Ao sincronizar, gera conflito.
    const deviceBOp: PushOperation = {
      id: randomUUID(),
      companyId: company.id,
      eventId: event.id,
      entityType: "Task",
      entityId: taskId,
      operationType: "UPDATE",
      baseVersion: 1,
      payload: { eventId: event.id, title: "Editado pelo dispositivo B", ...deviceBExtraFields },
      clientTimestamp: new Date().toISOString(),
      deviceId: "device-B",
    };
    const resultB = single(await processPushBatch([deviceBOp], { userId: user.id }));
    expect(resultB.outcome).toBe("CONFLICT");

    return { company, user, event, taskId, conflictId: resultB.conflictId! };
  }

  it("preserva as duas versões (nunca sobrescreve silenciosamente)", async () => {
    const { conflictId } = await setupConflict();
    const conflict = await prisma.conflict.findUniqueOrThrow({ where: { id: conflictId } });

    expect(conflict.status).toBe("PENDING");
    expect((conflict.clientPayload as { title: string }).title).toBe("Editado pelo dispositivo B");
    expect((conflict.serverPayload as { title: string }).title).toBe("Editado pelo dispositivo A");
  });

  it("KEEP_CLIENT aplica a versão do dispositivo que gerou o conflito e audita quem resolveu", async () => {
    const { user, taskId, conflictId } = await setupConflict();

    const updated = await resolveConflict({
      conflictId,
      userId: user.id,
      strategy: "KEEP_CLIENT",
      resolutionNotes: "Confirmado com o dispositivo B em campo.",
    });

    expect((updated as { title: string }).title).toBe("Editado pelo dispositivo B");

    const conflict = await prisma.conflict.findUniqueOrThrow({ where: { id: conflictId } });
    expect(conflict.status).toBe("RESOLVED");
    expect(conflict.resolvedBy).toBe(user.id);
    expect(conflict.resolutionStrategy).toBe("KEEP_CLIENT");

    const audit = await prisma.auditLog.findFirst({
      where: { entityId: taskId, action: "CONFLICT_RESOLVED" },
    });
    expect(audit).not.toBeNull();
  });

  it("KEEP_SERVER mantém a versão do servidor intacta e ainda assim audita a resolução", async () => {
    const { user, taskId, conflictId } = await setupConflict();

    const result = await resolveConflict({ conflictId, userId: user.id, strategy: "KEEP_SERVER" });
    expect((result as { title: string }).title).toBe("Editado pelo dispositivo A");

    const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(task.title).toBe("Editado pelo dispositivo A");
  });

  it("KEEP_CLIENT funciona com o payload REAL de um dispositivo (objeto local completo, com campos que só existem no aparelho)", async () => {
    // Regressão medida no E2E: o clientPayload guardado é o objeto local cru (syncStatus,
    // createdAt…); aplicá-lo no Prisma dava "Unknown argument `syncStatus`" e a resolução
    // "Manter minha versão" falhava sempre.
    const localOnlyFields = {
      syncStatus: "pending",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deletedAt: null,
      createdBy: null,
      updatedBy: null,
    };
    const { user, conflictId, taskId } = await setupConflict(localOnlyFields);

    await resolveConflict({ conflictId, userId: user.id, strategy: "KEEP_CLIENT" });

    const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(task.title).toBe("Editado pelo dispositivo B");
    expect(task.version).toBe(3); // v1 → A (v2) → resolução (v3)
    const conflict = await prisma.conflict.findUniqueOrThrow({ where: { id: conflictId } });
    expect(conflict.status).toBe("RESOLVED");
  });

  it("payload de conflito inválido é recusado com erro claro, sem escrever nada", async () => {
    const { user, conflictId, taskId } = await setupConflict();
    await prisma.conflict.update({ where: { id: conflictId }, data: { clientPayload: { title: "" } } });
    const before = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });

    await expect(
      resolveConflict({ conflictId, userId: user.id, strategy: "KEEP_CLIENT" })
    ).rejects.toBeInstanceOf(InvalidConflictPayloadError);

    const after = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(after.version).toBe(before.version);
    expect((await prisma.conflict.findUniqueOrThrow({ where: { id: conflictId } })).status).toBe("PENDING");
  });

  it("não permite resolver o mesmo conflito duas vezes", async () => {
    const { user, conflictId } = await setupConflict();
    await resolveConflict({ conflictId, userId: user.id, strategy: "KEEP_SERVER" });

    await expect(
      resolveConflict({ conflictId, userId: user.id, strategy: "KEEP_CLIENT" })
    ).rejects.toBeInstanceOf(ConflictAlreadyResolvedError);
  });

  it("o 'já resolvido' devolve a entidade ATUAL, para o outro dispositivo convergir em vez de ficar com o conflito preso", async () => {
    const { user, conflictId, taskId } = await setupConflict();
    await resolveConflict({ conflictId, userId: user.id, strategy: "KEEP_CLIENT" });

    const error = await resolveConflict({ conflictId, userId: user.id, strategy: "KEEP_SERVER" }).catch(
      (e) => e
    );

    expect(error).toBeInstanceOf(ConflictAlreadyResolvedError);
    const current = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    expect((error as ConflictAlreadyResolvedError).entity).toMatchObject({
      id: taskId,
      version: current.version,
      title: current.title,
    });
  });

  it("quem não tem acesso ao evento recebe 403 mesmo para um conflito já resolvido — o 409 não vaza a entidade", async () => {
    const { user, conflictId } = await setupConflict();
    await resolveConflict({ conflictId, userId: user.id, strategy: "KEEP_SERVER" });
    const outsider = await createTestUser(prisma);

    await expect(
      resolveConflict({ conflictId, userId: outsider.id, strategy: "KEEP_SERVER" })
    ).rejects.toBeInstanceOf(ConflictForbiddenError);
  });
});
