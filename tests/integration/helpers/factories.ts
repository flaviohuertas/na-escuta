import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * Testes de integração exigem um Postgres real (`docker compose up -d` +
 * `npx prisma migrate deploy` primeiro) — nunca rodam contra mocks. Use
 * TEST_DATABASE_URL (recomendado, banco isolado do de desenvolvimento) ou,
 * na ausência dele, DATABASE_URL.
 */
export function createTestPrismaClient(): PrismaClient {
  const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "Defina TEST_DATABASE_URL (ou DATABASE_URL) apontando para um Postgres de teste antes de rodar os testes de integração."
    );
  }
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

export async function createTestCompany(
  prisma: PrismaClient,
  overrides: Partial<{ name: string; offlineAccessDays: number }> = {}
) {
  return prisma.company.create({
    data: {
      name: overrides.name ?? `Empresa Teste ${randomUUID().slice(0, 8)}`,
      slug: `empresa-teste-${randomUUID()}`,
      offlineAccessDays: overrides.offlineAccessDays ?? 7,
    },
  });
}

export async function createTestUser(prisma: PrismaClient, email?: string) {
  return prisma.user.create({
    data: {
      email: email ?? `teste-${randomUUID()}@naescuta.com.br`,
      name: "Usuária de Teste",
      passwordHash: "não-usado-nestes-testes",
    },
  });
}

export async function createMembership(
  prisma: PrismaClient,
  userId: string,
  companyId: string,
  role: "OWNER" | "ADMIN" | "PRODUCER" | "STAFF" | "FREELANCER" | "VIEWER" = "PRODUCER"
) {
  return prisma.membership.create({ data: { userId, companyId, role } });
}

export async function createTestEvent(prisma: PrismaClient, companyId: string) {
  const now = new Date();
  return prisma.event.create({
    data: {
      companyId,
      name: `Evento Teste ${randomUUID().slice(0, 8)}`,
      startDate: now,
      endDate: new Date(now.getTime() + 86_400_000),
      status: "CONFIRMED",
    },
  });
}

export async function grantEventAccess(
  prisma: PrismaClient,
  userId: string,
  eventId: string,
  role: "MANAGER" | "FIELD_STAFF" | "VIEWER" = "MANAGER"
) {
  return prisma.eventAccess.create({ data: { userId, eventId, role } });
}

/** Desembrulha um array de 1 resultado esperado (falha alto e claro se não for exatamente 1). */
export function single<T>(arr: T[]): T {
  if (arr.length !== 1) {
    throw new Error(`Esperava exatamente 1 resultado, recebi ${arr.length}.`);
  }
  return arr[0] as T;
}

/** Limpa todas as tabelas de domínio entre testes, preservando o schema. */
export async function truncateAll(prisma: PrismaClient) {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "pending_approvals", "audit_log", "conflicts", "sync_outbox_log",
      "occurrence_evidence", "occurrences", "checklist_items", "checklist_templates",
      "tasks", "events", "devices", "event_access", "memberships", "companies", "users"
    RESTART IDENTITY CASCADE;
  `);
}
