/**
 * Derrubada de sessões abertas (integração — Postgres real, ver cabeçalho de sync-push.integration.test.ts).
 *
 * O JWT de sessão continua assinado e "válido" depois de a senha ser redefinida ou o vínculo
 * encerrado. `User.sessionVersion` é o que o torna revogável: o token guarda a versão do login e a
 * sessão só vale enquanto for igual à do banco. Estes testes provam QUANDO a versão sobe — e,
 * tão importante quanto, quando NÃO sobe (derrubar a sessão de quem nada fez é o outro defeito).
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createMembership,
  createTestCompany,
  createTestPrismaClient,
  createTestUser,
  truncateAll,
} from "../helpers/factories";
import { changeOwnPassword, hashPassword } from "@/server/auth/password";
import { isSessionCurrent, readSessionVersion } from "@/server/auth/session-version";
import { createEvent } from "@/server/events/event.service";
import { changeMember, resetMemberPassword } from "@/server/team/team.service";

const prisma = createTestPrismaClient();

type CompanyRole = "OWNER" | "ADMIN" | "PRODUCER" | "STAFF" | "FREELANCER" | "VIEWER";

describe("derrubada de sessões (integração — Postgres real)", () => {
  beforeEach(async () => {
    await truncateAll(prisma);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function setup() {
    const company = await createTestCompany(prisma);
    const owner = await createTestUser(prisma, `titular-${company.id}@x.com`);
    await createMembership(prisma, owner.id, company.id, "OWNER");
    return { company, owner };
  }

  async function person(companyId: string, role: CompanyRole) {
    const user = await createTestUser(prisma);
    const membership = await createMembership(prisma, user.id, companyId, role);
    return { user, membership };
  }

  /** O que o `jwt` callback grava no token ao entrar: a versão das sessões naquele instante. */
  async function login(userId: string): Promise<number> {
    const version = await readSessionVersion(userId);
    if (version === null) throw new Error("conta inativa ou inexistente");
    return version;
  }

  describe("isSessionCurrent", () => {
    it("vale enquanto a versão do token for a do banco", async () => {
      const user = await createTestUser(prisma);
      const version = await login(user.id);

      expect(await isSessionCurrent(user.id, version)).toBe(true);
    });

    it("token de antes desta regra (sem versão) vale numa conta que nunca teve a versão mexida — ninguém é deslogado no deploy", async () => {
      const user = await createTestUser(prisma);

      expect(await isSessionCurrent(user.id, undefined)).toBe(true);
    });

    it("cai quando a versão sobe — inclusive o token antigo sem versão", async () => {
      const user = await createTestUser(prisma);
      const version = await login(user.id);
      await prisma.user.update({ where: { id: user.id }, data: { sessionVersion: { increment: 1 } } });

      expect(await isSessionCurrent(user.id, version)).toBe(false);
      expect(await isSessionCurrent(user.id, undefined)).toBe(false);
    });

    it("cai para conta desativada, conta inexistente e token sem dono", async () => {
      const user = await createTestUser(prisma);
      const version = await login(user.id);
      await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });

      expect(await isSessionCurrent(user.id, version)).toBe(false);
      expect(await isSessionCurrent("00000000-0000-0000-0000-000000000000", 0)).toBe(false);
      expect(await isSessionCurrent(undefined, 0)).toBe(false);
      expect(await isSessionCurrent(42, 0)).toBe(false);
    });
  });

  describe("redefinição de senha pela administração", () => {
    it("derruba as sessões abertas de QUEM teve a senha redefinida — e só as dele", async () => {
      const { company, owner } = await setup();
      const target = await person(company.id, "STAFF");
      const bystander = await person(company.id, "STAFF");
      const [ownerV, targetV, bystanderV] = await Promise.all([login(owner.id), login(target.user.id), login(bystander.user.id)]);

      await resetMemberPassword({ actorId: owner.id, companyId: company.id, membershipId: target.membership.id });

      expect(await isSessionCurrent(target.user.id, targetV)).toBe(false);
      expect(await isSessionCurrent(owner.id, ownerV)).toBe(true);
      expect(await isSessionCurrent(bystander.user.id, bystanderV)).toBe(true);
    });

    it("recusada (papel insuficiente) não derruba ninguém", async () => {
      const { company } = await setup();
      const staff = await person(company.id, "STAFF");
      const other = await person(company.id, "STAFF");
      const otherV = await login(other.user.id);

      await expect(
        resetMemberPassword({ actorId: staff.user.id, companyId: company.id, membershipId: other.membership.id })
      ).rejects.toMatchObject({ name: "AdminActionError", status: 403 });

      expect(await isSessionCurrent(other.user.id, otherV)).toBe(true);
    });
  });

  describe("encerrar o vínculo", () => {
    it("derruba as sessões abertas de quem saiu — e só as dele", async () => {
      const { company, owner } = await setup();
      const leaving = await person(company.id, "STAFF");
      const staying = await person(company.id, "STAFF");
      const [ownerV, leavingV, stayingV] = await Promise.all([login(owner.id), login(leaving.user.id), login(staying.user.id)]);

      await changeMember({ actorId: owner.id, companyId: company.id, membershipId: leaving.membership.id, status: "REVOKED" });

      expect(await isSessionCurrent(leaving.user.id, leavingV)).toBe(false);
      expect(await isSessionCurrent(owner.id, ownerV)).toBe(true);
      expect(await isSessionCurrent(staying.user.id, stayingV)).toBe(true);
    });

    it("mudar só o papel NÃO derruba a sessão (o papel é lido do banco a cada chamada)", async () => {
      const { company, owner } = await setup();
      const member = await person(company.id, "STAFF");
      const version = await login(member.user.id);

      await changeMember({ actorId: owner.id, companyId: company.id, membershipId: member.membership.id, role: "PRODUCER" });

      expect(await isSessionCurrent(member.user.id, version)).toBe(true);
    });

    it("recusado (único gestor de um evento) não derruba a sessão: a transação inteira desfaz", async () => {
      const { company, owner } = await setup();
      const producer = await person(company.id, "PRODUCER");
      await createEvent({
        userId: producer.user.id,
        companyId: company.id,
        input: { name: "Festival", startDate: "2026-12-01T12:00:00.000Z", endDate: "2026-12-02T12:00:00.000Z", status: "PLANNED" },
      });
      const version = await login(producer.user.id);

      await expect(
        changeMember({ actorId: owner.id, companyId: company.id, membershipId: producer.membership.id, status: "REVOKED" })
      ).rejects.toMatchObject({ name: "AdminActionError", status: 409 });

      expect(await isSessionCurrent(producer.user.id, version)).toBe(true);
    });

    it("reativar o vínculo não ressuscita a sessão antiga", async () => {
      const { company, owner } = await setup();
      const member = await person(company.id, "STAFF");
      const oldVersion = await login(member.user.id);
      await changeMember({ actorId: owner.id, companyId: company.id, membershipId: member.membership.id, status: "REVOKED" });

      await changeMember({ actorId: owner.id, companyId: company.id, membershipId: member.membership.id, status: "ACTIVE" });

      expect(await isSessionCurrent(member.user.id, oldVersion)).toBe(false);
      expect(await isSessionCurrent(member.user.id, await login(member.user.id))).toBe(true);
    });
  });

  describe("a pessoa troca a própria senha", () => {
    it("derruba as sessões abertas (a atual é reemitida pela rota) e devolve o e-mail para reemiti-la", async () => {
      const user = await prisma.user.create({
        data: { email: "ana@x.com", name: "Ana", passwordHash: await hashPassword("senha-atual-longa") },
      });
      const version = await login(user.id);

      const result = await changeOwnPassword(user.id, { currentPassword: "senha-atual-longa", newPassword: "outra-senha-bem-longa" });

      expect(result).toEqual({ email: "ana@x.com" });
      expect(await isSessionCurrent(user.id, version)).toBe(false);
      expect(await isSessionCurrent(user.id, await login(user.id))).toBe(true);
    });

    it("com a senha atual errada nada muda: a sessão continua valendo", async () => {
      const user = await prisma.user.create({
        data: { email: "ana@x.com", name: "Ana", passwordHash: await hashPassword("senha-atual-longa") },
      });
      const version = await login(user.id);

      await expect(
        changeOwnPassword(user.id, { currentPassword: "errada-errada", newPassword: "outra-senha-bem-longa" })
      ).rejects.toMatchObject({ name: "AdminActionError", status: 422 });

      expect(await isSessionCurrent(user.id, version)).toBe(true);
    });
  });
});
