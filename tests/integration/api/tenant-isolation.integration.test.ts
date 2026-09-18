/**
 * Testes de integração — exigem Postgres real (ver cabeçalho de
 * sync-push.integration.test.ts). NÃO executados nesta sessão de
 * desenvolvimento.
 *
 * Garante que um usuário de uma empresa nunca lê nem escreve dados de um
 * evento de outra empresa, mesmo que ele conheça o id do evento/entidade.
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
import { pullChangesForEvent } from "@/server/sync/pull.service";
import { EventAccessDeniedError, bootstrapEvent } from "@/server/sync/bootstrap.service";

const prisma = createTestPrismaClient();

describe("isolamento entre empresas (integração — Postgres real)", () => {
  beforeEach(async () => {
    await truncateAll(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function setupTwoCompanies() {
    const companyA = await createTestCompany(prisma, { name: "Produtora A" });
    const companyB = await createTestCompany(prisma, { name: "Produtora B" });

    const userA = await createTestUser(prisma);
    await createMembership(prisma, userA.id, companyA.id, "PRODUCER");
    const eventA = await createTestEvent(prisma, companyA.id);
    await grantEventAccess(prisma, userA.id, eventA.id, "MANAGER");

    const userB = await createTestUser(prisma);
    await createMembership(prisma, userB.id, companyB.id, "PRODUCER");
    // userB NÃO tem Membership nem EventAccess relacionados à companyA/eventA.

    return { companyA, companyB, userA, userB, eventA };
  }

  it("push: usuário de outra empresa não consegue criar registro no evento alheio", async () => {
    const { userB, eventA, companyA } = await setupTwoCompanies();

    const result = single(await processPushBatch(
      [
        {
          id: randomUUID(),
          companyId: companyA.id,
          eventId: eventA.id,
          entityType: "Task",
          entityId: randomUUID(),
          operationType: "CREATE",
          baseVersion: null,
          payload: { eventId: eventA.id, title: "Tentativa de invasão" },
          clientTimestamp: new Date().toISOString(),
          deviceId: "device-intruso",
        },
      ],
      { userId: userB.id }
    ));

    expect(result.outcome).toBe("REJECTED");
    expect(["MEMBERSHIP_REVOKED", "EVENT_ACCESS_REVOKED"]).toContain(result.rejectionReason);

    const tasks = await prisma.task.findMany({ where: { eventId: eventA.id } });
    expect(tasks).toHaveLength(0);
  });

  it("pull: usuário de outra empresa recebe accessRevoked em vez dos dados", async () => {
    const { userB, eventA } = await setupTwoCompanies();

    const response = await pullChangesForEvent(eventA.id, null, { userId: userB.id });

    expect(response.accessRevoked).toBe(true);
    expect(response.changes).toHaveLength(0);
  });

  it("bootstrap: usuário de outra empresa não consegue preparar o evento offline", async () => {
    const { userB, eventA } = await setupTwoCompanies();

    await expect(bootstrapEvent(eventA.id, { userId: userB.id })).rejects.toBeInstanceOf(
      EventAccessDeniedError
    );
  });
});
