/**
 * Testes de integração — exigem Postgres real.
 * Rodar localmente com: docker compose up -d && npx prisma migrate deploy
 * && npm run test:integration (ou defina TEST_DATABASE_URL para um banco
 * dedicado a testes). NÃO executados nesta sessão de desenvolvimento
 * (sandbox sem Docker) — ver docs/PLANO.md.
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
import type { PushOperation } from "@/lib/sync/protocol";

const prisma = createTestPrismaClient();

function makeCreateTaskOp(overrides: Partial<PushOperation> = {}): PushOperation {
  return {
    id: randomUUID(),
    companyId: overrides.companyId!,
    eventId: overrides.eventId!,
    entityType: "Task",
    entityId: randomUUID(),
    operationType: "CREATE",
    baseVersion: null,
    payload: { eventId: overrides.eventId, title: "Tarefa de teste" },
    clientTimestamp: new Date().toISOString(),
    deviceId: "device-integration-1",
    ...overrides,
  };
}

describe("push.service (integração — Postgres real)", () => {
  beforeEach(async () => {
    await truncateAll(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("aplica um CREATE, grava AuditLog e SyncOutboxLog", async () => {
    const company = await createTestCompany(prisma);
    const user = await createTestUser(prisma);
    await createMembership(prisma, user.id, company.id, "PRODUCER");
    const event = await createTestEvent(prisma, company.id);
    await grantEventAccess(prisma, user.id, event.id, "MANAGER");

    const op = makeCreateTaskOp({ companyId: company.id, eventId: event.id });
    const result = single(await processPushBatch([op], { userId: user.id }));

    expect(result.outcome).toBe("APPLIED");
    expect(result.serverVersion).toBe(1);

    const task = await prisma.task.findUnique({ where: { id: op.entityId } });
    expect(task?.title).toBe("Tarefa de teste");

    const log = await prisma.syncOutboxLog.findUnique({ where: { id: op.id } });
    expect(log?.outcome).toBe("APPLIED");

    const audit = await prisma.auditLog.findFirst({ where: { entityId: op.entityId } });
    expect(audit?.action).toBe("CREATE");
  });

  it("reenviar a MESMA operação (mesmo id) não duplica — retorna DUPLICATE_IGNORED", async () => {
    const company = await createTestCompany(prisma);
    const user = await createTestUser(prisma);
    await createMembership(prisma, user.id, company.id, "PRODUCER");
    const event = await createTestEvent(prisma, company.id);
    await grantEventAccess(prisma, user.id, event.id, "MANAGER");

    const op = makeCreateTaskOp({ companyId: company.id, eventId: event.id });

    const first = single(await processPushBatch([op], { userId: user.id }));
    const second = single(await processPushBatch([op], { userId: user.id }));

    expect(first.outcome).toBe("APPLIED");
    expect(second.outcome).toBe("DUPLICATE_IGNORED");

    const allTasks = await prisma.task.findMany({ where: { id: op.entityId } });
    expect(allTasks).toHaveLength(1); // não duplicou
  });

  it("rejeita escrita de usuário sem EventAccess ativo (VALIDATION/FORBIDDEN, nunca aplica)", async () => {
    const company = await createTestCompany(prisma);
    const user = await createTestUser(prisma);
    await createMembership(prisma, user.id, company.id, "PRODUCER");
    const event = await createTestEvent(prisma, company.id);
    // Nota: sem grantEventAccess — usuário não tem acesso a este evento específico.

    const op = makeCreateTaskOp({ companyId: company.id, eventId: event.id });
    const result = single(await processPushBatch([op], { userId: user.id }));

    expect(result.outcome).toBe("REJECTED");
    expect(result.rejectionReason).toBe("EVENT_ACCESS_REVOKED");

    const task = await prisma.task.findUnique({ where: { id: op.entityId } });
    expect(task).toBeNull();
  });

  it("detecta conflito quando baseVersion do cliente está desatualizado", async () => {
    const company = await createTestCompany(prisma);
    const user = await createTestUser(prisma);
    await createMembership(prisma, user.id, company.id, "PRODUCER");
    const event = await createTestEvent(prisma, company.id);
    await grantEventAccess(prisma, user.id, event.id, "MANAGER");

    const createOp = makeCreateTaskOp({ companyId: company.id, eventId: event.id });
    await processPushBatch([createOp], { userId: user.id });

    // Alguém mais (outro dispositivo) já atualizou para version=2 no meio tempo.
    await prisma.task.update({ where: { id: createOp.entityId }, data: { version: 2, title: "Mudou em outro lugar" } });

    const staleUpdateOp: PushOperation = {
      id: randomUUID(),
      companyId: company.id,
      eventId: event.id,
      entityType: "Task",
      entityId: createOp.entityId,
      operationType: "UPDATE",
      baseVersion: 1, // cliente ainda acha que está na v1
      payload: { eventId: event.id, title: "Minha edição local" },
      clientTimestamp: new Date().toISOString(),
      deviceId: "device-integration-1",
    };

    const result = single(await processPushBatch([staleUpdateOp], { userId: user.id }));
    expect(result.outcome).toBe("CONFLICT");
    expect(result.conflictId).toBeDefined();

    const conflict = await prisma.conflict.findUnique({ where: { id: result.conflictId! } });
    expect(conflict?.baseVersion).toBe(1);
    expect(conflict?.serverVersion).toBe(2);
  });
});
