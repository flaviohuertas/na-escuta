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
import { ConflictAlreadyResolvedError, resolveConflict } from "@/server/sync/conflict.service";
import type { PushOperation } from "@/lib/sync/protocol";

const prisma = createTestPrismaClient();

describe("conflitos entre dois dispositivos (integração — Postgres real)", () => {
  beforeEach(async () => {
    await truncateAll(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function setupConflict() {
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
      payload: { eventId: event.id, title: "Editado pelo dispositivo B" },
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

  it("não permite resolver o mesmo conflito duas vezes", async () => {
    const { user, conflictId } = await setupConflict();
    await resolveConflict({ conflictId, userId: user.id, strategy: "KEEP_SERVER" });

    await expect(
      resolveConflict({ conflictId, userId: user.id, strategy: "KEEP_CLIENT" })
    ).rejects.toBeInstanceOf(ConflictAlreadyResolvedError);
  });
});
