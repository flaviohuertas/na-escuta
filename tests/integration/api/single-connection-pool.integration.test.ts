/**
 * Serviços com o pool de UMA conexão (integração — Postgres real, ver cabeçalho de
 * sync-push.integration.test.ts).
 *
 * Uma transação segura uma conexão até o fim. Se, lá dentro, alguém consulta pelo cliente global em
 * vez de pelo `tx`, a consulta pede uma SEGUNDA conexão: com o pool de 10 passa despercebido, mas
 * com o pool cheio todas as transações esperam umas pelas outras (e num banco local de conexão única,
 * como o `prisma dev`, trava na primeira vez). `DATABASE_POOL_MAX=1` torna o defeito determinístico:
 * a consulta fora do `tx` espera uma conexão que nunca é liberada e o teste estoura o tempo.
 *
 * Os serviços são importados depois de a variável ser fixada — o pool é criado na importação.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createMembership, createTestCompany, createTestPrismaClient, createTestUser, truncateAll } from "../helpers/factories";

const prisma = createTestPrismaClient();

const eventInput = {
  name: "Festival",
  startDate: "2026-12-01T12:00:00.000Z",
  endDate: "2026-12-02T12:00:00.000Z",
  status: "PLANNED" as const,
};

async function loadServicesWithSingleConnection() {
  vi.stubEnv("DATABASE_POOL_MAX", "1");
  delete (globalThis as { prisma?: unknown }).prisma; // o singleton de dev guardaria um pool já criado
  vi.resetModules();
  const app = await import("@/lib/db/prisma");
  const events = await import("@/server/events/event.service");
  const access = await import("@/server/events/event-access.service");
  return { appPrisma: app.prisma, createEvent: events.createEvent, ...access };
}

describe("serviços com o pool de uma conexão (integração — Postgres real)", () => {
  let svc: Awaited<ReturnType<typeof loadServicesWithSingleConnection>>;

  beforeAll(async () => {
    svc = await loadServicesWithSingleConnection();
  });
  beforeEach(async () => {
    await truncateAll(prisma);
  });
  afterAll(async () => {
    await svc?.appPrisma.$disconnect();
    vi.unstubAllEnvs();
    await prisma.$disconnect();
  });

  const adminError = (status: number) => expect.objectContaining({ name: "AdminActionError", status });

  async function setup() {
    const company = await createTestCompany(prisma);
    const manager = await createTestUser(prisma);
    await createMembership(prisma, manager.id, company.id, "PRODUCER");
    const person = await createTestUser(prisma);
    await createMembership(prisma, person.id, company.id, "STAFF");
    const event = await svc.createEvent({ userId: manager.id, companyId: company.id, input: eventInput });
    return { manager, person, event };
  }

  it("reativar o acesso ao evento não pede uma segunda conexão dentro da transação", async () => {
    const { manager, person, event } = await setup();

    await svc.grantEventAccess({ actorId: manager.id, eventId: event.id, userId: person.id, role: "VIEWER" });
    await svc.changeEventAccess({ actorId: manager.id, eventId: event.id, userId: person.id, status: "REVOKED" });
    const reactivated = await svc.changeEventAccess({ actorId: manager.id, eventId: event.id, userId: person.id, status: "ACTIVE" });

    expect(reactivated).toMatchObject({ status: "ACTIVE", role: "VIEWER" });
  });

  it("recusar a reativação de quem saiu da empresa também termina (e não deixa a transação pendurada)", async () => {
    const { manager, person, event } = await setup();
    await svc.grantEventAccess({ actorId: manager.id, eventId: event.id, userId: person.id, role: "VIEWER" });
    await svc.changeEventAccess({ actorId: manager.id, eventId: event.id, userId: person.id, status: "REVOKED" });
    await prisma.membership.updateMany({ where: { userId: person.id }, data: { status: "REVOKED", revokedAt: new Date() } });

    await expect(
      svc.changeEventAccess({ actorId: manager.id, eventId: event.id, userId: person.id, status: "ACTIVE" })
    ).rejects.toEqual(adminError(422));

    // A conexão voltou ao pool: a próxima operação não fica esperando.
    const still = await prisma.eventAccess.findFirstOrThrow({ where: { userId: person.id, eventId: event.id } });
    expect(still.status).toBe("REVOKED");
    await expect(svc.listEventAccess({ actorId: manager.id, eventId: event.id })).resolves.toBeDefined();
  });
});
