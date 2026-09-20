/**
 * Login (integração — Postgres real, ver cabeçalho de sync-push.integration.test.ts).
 * A regra vive em `authenticateCredentials`; o NextAuth só a chama.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createMembership, createTestCompany, createTestPrismaClient, truncateAll } from "../helpers/factories";
import { authenticateCredentials } from "@/server/auth/credentials";
import { hashPassword } from "@/server/auth/password";

const prisma = createTestPrismaClient();
const PASSWORD = "uma-senha-que-so-ela-sabe";

describe("authenticateCredentials (integração — Postgres real)", () => {
  beforeEach(async () => {
    await truncateAll(prisma);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Conta com senha conhecida e, por padrão, vínculo ativo com uma empresa (sem ele não há o que abrir). */
  async function account(overrides: { email?: string; isActive?: boolean; membership?: boolean } = {}) {
    const user = await prisma.user.create({
      data: {
        email: overrides.email ?? "ana@produtora.com.br",
        name: "Ana",
        passwordHash: await hashPassword(PASSWORD),
        isActive: overrides.isActive ?? true,
      },
    });
    if (overrides.membership ?? true) {
      const company = await createTestCompany(prisma);
      await createMembership(prisma, user.id, company.id, "STAFF");
    }
    return user;
  }

  it("entra com e-mail e senha corretos", async () => {
    const user = await account();

    expect(await authenticateCredentials({ email: "ana@produtora.com.br", password: PASSWORD })).toEqual({
      id: user.id,
      email: "ana@produtora.com.br",
      name: "Ana",
    });
  });

  it("o e-mail digitado em maiúsculas e com espaços é a MESMA conta (cadastrado sempre em minúsculo)", async () => {
    // Regressão: o login procurava o e-mail exatamente como digitado; quem a administração
    // cadastrou como "Ana@X.com" (gravado em minúsculo) não conseguiria entrar digitando assim.
    const user = await account();

    for (const typed of ["ANA@PRODUTORA.COM.BR", "  Ana@Produtora.com.br  ", "aNa@produtora.com.br"]) {
      expect((await authenticateCredentials({ email: typed, password: PASSWORD }))?.id, typed).toBe(user.id);
    }
  });

  it("recusa (null) senha errada, conta inexistente e conta desativada — sem distinguir", async () => {
    await account();
    await account({ email: "desativada@x.com", isActive: false });

    expect(await authenticateCredentials({ email: "ana@produtora.com.br", password: "errada" })).toBeNull();
    expect(await authenticateCredentials({ email: "ninguem@x.com", password: PASSWORD })).toBeNull();
    expect(await authenticateCredentials({ email: "desativada@x.com", password: PASSWORD })).toBeNull();
  });

  it("recusa quem não tem vínculo ativo com nenhuma empresa — nunca, nem com a senha certa", async () => {
    // Regressão do laço de redirecionamento: com sessão e sem empresa, `/login` mandava para o app
    // e o app mandava de volta para `/login`. É o caso de quem teve o vínculo encerrado.
    await account({ email: "sem-vinculo@x.com", membership: false });
    const ended = await account({ email: "encerrado@x.com" });
    await prisma.membership.updateMany({ where: { userId: ended.id }, data: { status: "REVOKED", revokedAt: new Date() } });

    expect(await authenticateCredentials({ email: "sem-vinculo@x.com", password: PASSWORD })).toBeNull();
    expect(await authenticateCredentials({ email: "encerrado@x.com", password: PASSWORD })).toBeNull();
  });

  it("recusa entrada malformada em vez de estourar", async () => {
    await account();

    for (const raw of [null, undefined, {}, { email: "ana@produtora.com.br" }, { email: "isso-nao-e-email", password: PASSWORD }, { email: "ana@produtora.com.br", password: "" }]) {
      expect(await authenticateCredentials(raw), JSON.stringify(raw)).toBeNull();
    }
  });

  it("conta que ainda usa senha PROVISÓRIA entra (a troca obrigatória é imposta depois, no shell do app)", async () => {
    const user = await account();
    await prisma.user.update({ where: { id: user.id }, data: { mustChangePassword: true } });

    expect(await authenticateCredentials({ email: "ana@produtora.com.br", password: PASSWORD })).not.toBeNull();
  });
});
