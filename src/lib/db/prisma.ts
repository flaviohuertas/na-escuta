import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * Bancos locais de uma conexão só (o `prisma dev`, em PGlite) derrubam a segunda conexão
 * simultânea, e o Next abre várias por requisição (layout e página consultam juntos).
 * `DATABASE_POOL_MAX=1` faz o pool enfileirar as consultas. Sem a variável vale o padrão do pool.
 */
function poolMaxFromEnv(): number | undefined {
  const max = Number.parseInt(process.env.DATABASE_POOL_MAX ?? "", 10);
  return Number.isInteger(max) && max > 0 ? max : undefined;
}

function createPrismaClient() {
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 5000,
    max: poolMaxFromEnv(),
  });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
