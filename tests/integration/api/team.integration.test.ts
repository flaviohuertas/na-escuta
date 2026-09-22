/**
 * Equipe da empresa e senha (integração — Postgres real, ver cabeçalho de sync-push.integration.test.ts).
 *
 * O que importa: só titular e administração mexem, e nunca acima do próprio nível; ninguém mexe
 * em si mesmo nem em outra empresa; a senha provisória sai UMA vez e não deixa rastro em claro;
 * encerrar o vínculo corta os acessos e nunca deixa um evento sem gestor.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createMembership,
  createTestCompany,
  createTestPrismaClient,
  createTestUser,
  truncateAll,
} from "../helpers/factories";
import { hashPassword, verifyPassword, changeOwnPassword } from "@/server/auth/password";
import { createEvent } from "@/server/events/event.service";
import { grantEventAccess as grantAccess } from "@/server/events/event-access.service";
import { authorizeEventAccess } from "@/server/sync/authorize";
import { addMember, changeMember, listTeam, resetMemberPassword } from "@/server/team/team.service";

const prisma = createTestPrismaClient();

type CompanyRole = "OWNER" | "ADMIN" | "PRODUCER" | "STAFF" | "FREELANCER" | "VIEWER";

const eventInput = {
  name: "Festival",
  startDate: "2026-12-01T12:00:00.000Z",
  endDate: "2026-12-02T12:00:00.000Z",
  status: "PLANNED" as const,
};

const TEMP_FORMAT = /^[A-HJ-NP-Za-km-z2-9]{4}-[A-HJ-NP-Za-km-z2-9]{4}-[A-HJ-NP-Za-km-z2-9]{4}$/;

describe("equipe e senha (integração — Postgres real)", () => {
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

  async function person(companyId: string, role: CompanyRole, email?: string) {
    const user = await createTestUser(prisma, email);
    const membership = await createMembership(prisma, user.id, companyId, role);
    return { user, membership };
  }

  const adminError = (status: number) => expect.objectContaining({ name: "AdminActionError", status });

  describe("cadastrar", () => {
    it("titular cadastra e-mail novo: conta criada com senha provisória, troca obrigatória, e-mail e nome como informados", async () => {
      const { company, owner } = await setup();

      const result = await addMember({
        actorId: owner.id,
        companyId: company.id,
        name: "Pessoa Nova",
        email: "pessoa.nova@x.com",
        role: "STAFF",
      });

      expect(result.temporaryPassword).toMatch(TEMP_FORMAT);
      const user = await prisma.user.findUniqueOrThrow({ where: { id: result.userId } });
      expect(user).toMatchObject({ email: "pessoa.nova@x.com", name: "Pessoa Nova", mustChangePassword: true, isActive: true });
      expect(await verifyPassword(result.temporaryPassword!, user.passwordHash)).toBe(true);
      const membership = await prisma.membership.findUniqueOrThrow({ where: { id: result.membershipId } });
      expect(membership).toMatchObject({ companyId: company.id, userId: user.id, role: "STAFF", status: "ACTIVE" });
    });

    it("a senha provisória e o hash NÃO ficam em claro no histórico de auditoria", async () => {
      const { company, owner } = await setup();

      const result = await addMember({ actorId: owner.id, companyId: company.id, name: "Pessoa", email: "p@x.com", role: "STAFF" });

      const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "MEMBER_ADDED" } });
      const everything = JSON.stringify(audit);
      expect(everything).not.toContain(result.temporaryPassword!);
      expect(everything).not.toMatch(/\$2[aby]\$/); // formato do hash bcrypt
      expect(everything.toLowerCase()).not.toContain("password");
      expect(audit).toMatchObject({ userId: owner.id, companyId: company.id, entityType: "Membership", entityId: result.membershipId });
    });

    it("a administração cadastra papéis de baixo, mas NÃO titular nem administração; quem não administra não cadastra", async () => {
      const { company } = await setup();
      const admin = await person(company.id, "ADMIN");

      await expect(
        addMember({ actorId: admin.user.id, companyId: company.id, name: "A", email: "a1@x.com", role: "PRODUCER" })
      ).resolves.toMatchObject({ temporaryPassword: expect.any(String) });
      for (const role of ["OWNER", "ADMIN"] as const) {
        await expect(
          addMember({ actorId: admin.user.id, companyId: company.id, name: "B", email: `${role}@x.com`, role })
        ).rejects.toEqual(adminError(403));
      }
      for (const role of ["PRODUCER", "STAFF", "FREELANCER", "VIEWER"] as const) {
        const nobody = await person(company.id, role);
        await expect(
          addMember({ actorId: nobody.user.id, companyId: company.id, name: "C", email: `c-${role}@x.com`, role: "VIEWER" })
        ).rejects.toEqual(adminError(403));
      }
    });

    it("quem tem vínculo REVOGADO com a empresa (mesmo com sessão válida) não cadastra ninguém", async () => {
      const { company } = await setup();
      const admin = await person(company.id, "ADMIN");
      await prisma.membership.update({ where: { id: admin.membership.id }, data: { status: "REVOKED", revokedAt: new Date() } });

      await expect(
        addMember({ actorId: admin.user.id, companyId: company.id, name: "A", email: "a@x.com", role: "STAFF" })
      ).rejects.toEqual(adminError(403));
    });

    it("e-mail já ativo na equipe: 409; e-mail com conta ativa em OUTRA empresa: 409", async () => {
      const { company, owner } = await setup();
      await person(company.id, "STAFF", "ja-na-equipe@x.com");
      const outra = await createTestCompany(prisma);
      await person(outra.id, "OWNER", "de-outra-empresa@x.com");

      await expect(
        addMember({ actorId: owner.id, companyId: company.id, name: "X", email: "ja-na-equipe@x.com", role: "STAFF" })
      ).rejects.toEqual(adminError(409));
      await expect(
        addMember({ actorId: owner.id, companyId: company.id, name: "X", email: "de-outra-empresa@x.com", role: "STAFF" })
      ).rejects.toEqual(adminError(409));
    });

    it("conta que existe mas sem empresa ativa: só vincula — a senha dela NÃO muda e não há senha provisória", async () => {
      const { company, owner } = await setup();
      const lone = await prisma.user.create({
        data: { email: "solta@x.com", name: "Solta", passwordHash: await hashPassword("senha-que-ela-ja-tinha") },
      });

      const result = await addMember({ actorId: owner.id, companyId: company.id, name: "Solta", email: "solta@x.com", role: "VIEWER" });

      expect(result.temporaryPassword).toBeNull();
      const after = await prisma.user.findUniqueOrThrow({ where: { id: lone.id } });
      expect(after.mustChangePassword).toBe(false);
      expect(await verifyPassword("senha-que-ela-ja-tinha", after.passwordHash)).toBe(true);
    });

    it("vínculo encerrado antes: cadastrar de novo REATIVA (papel novo, senha intacta) — mas a administração não reativa um titular", async () => {
      const { company, owner } = await setup();
      const admin = await person(company.id, "ADMIN");
      const gone = await person(company.id, "STAFF", "voltou@x.com");
      const goneOwner = await person(company.id, "OWNER", "ex-titular@x.com");
      await prisma.membership.updateMany({
        where: { id: { in: [gone.membership.id, goneOwner.membership.id] } },
        data: { status: "REVOKED", revokedAt: new Date() },
      });

      const back = await addMember({ actorId: admin.user.id, companyId: company.id, name: "V", email: "voltou@x.com", role: "PRODUCER" });
      expect(back.temporaryPassword).toBeNull();
      expect(await prisma.membership.findUniqueOrThrow({ where: { id: gone.membership.id } })).toMatchObject({
        status: "ACTIVE",
        role: "PRODUCER",
        revokedAt: null,
      });

      await expect(
        addMember({ actorId: admin.user.id, companyId: company.id, name: "T", email: "ex-titular@x.com", role: "STAFF" })
      ).rejects.toEqual(adminError(403));
      // O titular reativa normalmente.
      await expect(
        addMember({ actorId: owner.id, companyId: company.id, name: "T", email: "ex-titular@x.com", role: "STAFF" })
      ).resolves.toMatchObject({ temporaryPassword: null });
    });

    it("conta desativada não é recadastrada", async () => {
      const { company, owner } = await setup();
      const off = await person(company.id, "STAFF", "desativada@x.com");
      await prisma.membership.update({ where: { id: off.membership.id }, data: { status: "REVOKED" } });
      await prisma.user.update({ where: { id: off.user.id }, data: { isActive: false } });

      await expect(
        addMember({ actorId: owner.id, companyId: company.id, name: "D", email: "desativada@x.com", role: "STAFF" })
      ).rejects.toEqual(adminError(422));
    });

    it("cadastros simultâneos do mesmo e-mail novo: uma conta só, uma senha provisória só", async () => {
      const { company, owner } = await setup();
      for (let round = 0; round < 6; round++) {
        const email = `corrida-${round}@x.com`;

        const results = await Promise.allSettled(
          Array.from({ length: 3 }, () =>
            addMember({ actorId: owner.id, companyId: company.id, name: "Corrida", email, role: "STAFF" })
          )
        );

        expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
        for (const r of results.filter((r): r is PromiseRejectedResult => r.status === "rejected")) {
          expect(r.reason).toEqual(adminError(409));
        }
        expect(await prisma.user.count({ where: { email } })).toBe(1);
        expect(await prisma.membership.count({ where: { user: { email } } })).toBe(1);
      }
    }, 60_000); // 18 hashes bcrypt (lentos de propósito), mais lentos ainda com a máquina carregada
  });

  describe("alterar papel, encerrar e reativar", () => {
    it("titular muda o papel de alguém e o histórico guarda antes e depois", async () => {
      const { company, owner } = await setup();
      const staff = await person(company.id, "STAFF");

      await changeMember({ actorId: owner.id, companyId: company.id, membershipId: staff.membership.id, role: "PRODUCER" });

      expect((await prisma.membership.findUniqueOrThrow({ where: { id: staff.membership.id } })).role).toBe("PRODUCER");
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "MEMBER_ROLE_CHANGED" } });
      expect(audit.beforeJson).toMatchObject({ role: "STAFF" });
      expect(audit.afterJson).toMatchObject({ role: "PRODUCER" });
    });

    it("desativa e reativa a conta sem encerrar o vínculo da empresa", async () => {
      const { company, owner } = await setup();
      const staff = await person(company.id, "STAFF");
      await prisma.device.create({ data: { id: "device-123", userId: staff.user.id, companyId: company.id, label: "Teste" } });

      await changeMember({ actorId: owner.id, companyId: company.id, membershipId: staff.membership.id, isActive: false });
      let after = await prisma.user.findUniqueOrThrow({ where: { id: staff.user.id } });
      expect(after.isActive).toBe(false);
      expect((await prisma.membership.findUniqueOrThrow({ where: { id: staff.membership.id } })).status).toBe("ACTIVE");
      expect((await prisma.device.findUniqueOrThrow({ where: { id: "device-123" } })).revokedAt).not.toBeNull();

      await changeMember({ actorId: owner.id, companyId: company.id, membershipId: staff.membership.id, isActive: true });
      after = await prisma.user.findUniqueOrThrow({ where: { id: staff.user.id } });
      expect(after.isActive).toBe(true);
    });

    it("a administração não altera titular nem par, nem concede papel de cima; altera papéis de baixo", async () => {
      const { company, owner } = await setup();
      const admin = await person(company.id, "ADMIN");
      const peer = await person(company.id, "ADMIN");
      const staff = await person(company.id, "STAFF");
      const membershipOf = async (userId: string) =>
        (await prisma.membership.findFirstOrThrow({ where: { userId } })).id;

      await expect(
        changeMember({ actorId: admin.user.id, companyId: company.id, membershipId: await membershipOf(owner.id), status: "REVOKED" })
      ).rejects.toEqual(adminError(403));
      await expect(
        changeMember({ actorId: admin.user.id, companyId: company.id, membershipId: peer.membership.id, role: "VIEWER" })
      ).rejects.toEqual(adminError(403));
      await expect(
        changeMember({ actorId: admin.user.id, companyId: company.id, membershipId: staff.membership.id, role: "ADMIN" })
      ).rejects.toEqual(adminError(403));
      await expect(
        changeMember({ actorId: admin.user.id, companyId: company.id, membershipId: staff.membership.id, role: "FREELANCER" })
      ).resolves.toMatchObject({ role: "FREELANCER" });
    });

    it("ninguém altera o próprio vínculo — nem o único titular consegue se rebaixar e deixar a empresa sem titular", async () => {
      const { company, owner } = await setup();
      const ownMembership = await prisma.membership.findFirstOrThrow({ where: { userId: owner.id } });

      await expect(
        changeMember({ actorId: owner.id, companyId: company.id, membershipId: ownMembership.id, role: "VIEWER" })
      ).rejects.toEqual(adminError(403));
      await expect(
        changeMember({ actorId: owner.id, companyId: company.id, membershipId: ownMembership.id, status: "REVOKED" })
      ).rejects.toEqual(adminError(403));
      expect(await prisma.membership.findUniqueOrThrow({ where: { id: ownMembership.id } })).toMatchObject({ role: "OWNER", status: "ACTIVE" });
    });

    it("membro de OUTRA empresa é 'não encontrado' (nunca se toca a equipe de fora)", async () => {
      const { company, owner } = await setup();
      const outra = await createTestCompany(prisma);
      const stranger = await person(outra.id, "STAFF");

      await expect(
        changeMember({ actorId: owner.id, companyId: company.id, membershipId: stranger.membership.id, role: "VIEWER" })
      ).rejects.toEqual(adminError(404));
      await expect(
        resetMemberPassword({ actorId: owner.id, companyId: company.id, membershipId: stranger.membership.id })
      ).rejects.toEqual(adminError(404));
    });

    it("encerrar o vínculo RETIRA os acessos da pessoa aos eventos da empresa (e só os dessa empresa)", async () => {
      // Se ficassem "dormindo", reativar a pessoa devolveria, sem ninguém decidir, tudo o que ela via.
      const { company, owner } = await setup();
      const event = await createEvent({ userId: owner.id, companyId: company.id, input: eventInput });
      const staff = await person(company.id, "STAFF");
      await grantAccess({ actorId: owner.id, eventId: event.id, userId: staff.user.id, role: "FIELD_STAFF" });
      // O mesmo usuário com acesso a um evento de OUTRA empresa: não é afetado.
      const outra = await createTestCompany(prisma);
      const outroOwner = await person(outra.id, "OWNER");
      const outroEvento = await createEvent({ userId: outroOwner.user.id, companyId: outra.id, input: eventInput });
      await prisma.eventAccess.create({ data: { userId: staff.user.id, eventId: outroEvento.id, role: "VIEWER" } });
      expect((await authorizeEventAccess({ userId: staff.user.id }, event.id)).allowed).toBe(true);

      await changeMember({ actorId: owner.id, companyId: company.id, membershipId: staff.membership.id, status: "REVOKED" });

      expect(await prisma.membership.findUniqueOrThrow({ where: { id: staff.membership.id } })).toMatchObject({ status: "REVOKED" });
      expect(await authorizeEventAccess({ userId: staff.user.id }, event.id)).toMatchObject({ allowed: false });
      const own = await prisma.eventAccess.findFirstOrThrow({ where: { userId: staff.user.id, eventId: event.id } });
      expect(own).toMatchObject({ status: "REVOKED" });
      expect(own.revokedAt).toBeInstanceOf(Date);
      expect((await prisma.eventAccess.findFirstOrThrow({ where: { userId: staff.user.id, eventId: outroEvento.id } })).status).toBe("ACTIVE");
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "MEMBER_REVOKED" } });
      expect(audit.metadata).toMatchObject({ eventAccessRevoked: 1 });
    });

    it("reativar o vínculo NÃO devolve os acessos a eventos: têm de ser dados de novo", async () => {
      const { company, owner } = await setup();
      const event = await createEvent({ userId: owner.id, companyId: company.id, input: eventInput });
      const staff = await person(company.id, "STAFF");
      await grantAccess({ actorId: owner.id, eventId: event.id, userId: staff.user.id, role: "FIELD_STAFF" });
      await changeMember({ actorId: owner.id, companyId: company.id, membershipId: staff.membership.id, status: "REVOKED" });

      await changeMember({ actorId: owner.id, companyId: company.id, membershipId: staff.membership.id, status: "ACTIVE" });

      expect(await prisma.membership.findUniqueOrThrow({ where: { id: staff.membership.id } })).toMatchObject({ status: "ACTIVE", revokedAt: null });
      expect(await authorizeEventAccess({ userId: staff.user.id }, event.id)).toMatchObject({
        allowed: false,
        reason: "EVENT_ACCESS_REVOKED",
      });
    });

    it("não encerra o vínculo do ÚNICO gestor de um evento — diz qual evento — e nada muda; com outro gestor, encerra", async () => {
      const { company, owner } = await setup();
      const producer = await person(company.id, "PRODUCER");
      const event = await createEvent({ userId: producer.user.id, companyId: company.id, input: { ...eventInput, name: "Festival do Parque" } });

      const error = await changeMember({
        actorId: owner.id,
        companyId: company.id,
        membershipId: producer.membership.id,
        status: "REVOKED",
      }).catch((e) => e);

      expect(error).toEqual(adminError(409));
      expect((error as Error).message).toContain("Festival do Parque");
      expect(await prisma.membership.findUniqueOrThrow({ where: { id: producer.membership.id } })).toMatchObject({ status: "ACTIVE" });
      expect(await prisma.eventAccess.findFirstOrThrow({ where: { userId: producer.user.id, eventId: event.id } })).toMatchObject({ status: "ACTIVE" });

      // O titular assume a gestão do evento; agora a produtora pode sair.
      await grantAccess({ actorId: producer.user.id, eventId: event.id, userId: owner.id, role: "MANAGER" });
      await expect(
        changeMember({ actorId: owner.id, companyId: company.id, membershipId: producer.membership.id, status: "REVOKED" })
      ).resolves.toMatchObject({ status: "REVOKED" });
    });

    it("mudar o papel de vínculo já encerrado exige reativar antes (422); reativar conta desativada também é recusado (422)", async () => {
      const { company, owner } = await setup();
      const staff = await person(company.id, "STAFF");
      await changeMember({ actorId: owner.id, companyId: company.id, membershipId: staff.membership.id, status: "REVOKED" });

      await expect(
        changeMember({ actorId: owner.id, companyId: company.id, membershipId: staff.membership.id, role: "VIEWER" })
      ).rejects.toEqual(adminError(422));

      await prisma.user.update({ where: { id: staff.user.id }, data: { isActive: false } });
      await expect(
        changeMember({ actorId: owner.id, companyId: company.id, membershipId: staff.membership.id, status: "ACTIVE" })
      ).rejects.toEqual(adminError(422));
    });
  });

  describe("redefinir a senha de alguém", () => {
    it("gera senha provisória nova, troca obrigatória, invalida a antiga — e audita sem rastro da senha", async () => {
      const { company, owner } = await setup();
      const staff = await person(company.id, "STAFF");
      await prisma.user.update({ where: { id: staff.user.id }, data: { passwordHash: await hashPassword("senha-antiga-dela") } });

      const { temporaryPassword } = await resetMemberPassword({
        actorId: owner.id,
        companyId: company.id,
        membershipId: staff.membership.id,
      });

      expect(temporaryPassword).toMatch(TEMP_FORMAT);
      const after = await prisma.user.findUniqueOrThrow({ where: { id: staff.user.id } });
      expect(after.mustChangePassword).toBe(true);
      expect(await verifyPassword(temporaryPassword, after.passwordHash)).toBe(true);
      expect(await verifyPassword("senha-antiga-dela", after.passwordHash)).toBe(false);
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "MEMBER_PASSWORD_RESET" } });
      expect(JSON.stringify(audit)).not.toContain(temporaryPassword);
      expect(audit).toMatchObject({ userId: owner.id, entityType: "User", entityId: staff.user.id });
    });

    it("não redefine a própria senha, a de um titular (pela administração), nem a de quem está com vínculo encerrado", async () => {
      const { company, owner } = await setup();
      const admin = await person(company.id, "ADMIN");
      const staff = await person(company.id, "STAFF");
      const ownerMembership = await prisma.membership.findFirstOrThrow({ where: { userId: owner.id } });

      await expect(
        resetMemberPassword({ actorId: admin.user.id, companyId: company.id, membershipId: admin.membership.id })
      ).rejects.toEqual(adminError(403));
      await expect(
        resetMemberPassword({ actorId: admin.user.id, companyId: company.id, membershipId: ownerMembership.id })
      ).rejects.toEqual(adminError(403));
      await prisma.membership.update({ where: { id: staff.membership.id }, data: { status: "REVOKED" } });
      await expect(
        resetMemberPassword({ actorId: owner.id, companyId: company.id, membershipId: staff.membership.id })
      ).rejects.toEqual(adminError(422));
    });
  });

  describe("trocar a própria senha", () => {
    it("com a senha atual certa: grava a nova, tira a troca obrigatória e audita", async () => {
      const { company } = await setup();
      const staff = await person(company.id, "STAFF");
      await prisma.user.update({
        where: { id: staff.user.id },
        data: { passwordHash: await hashPassword("Provisoria-1"), mustChangePassword: true },
      });

      await changeOwnPassword(staff.user.id, { currentPassword: "Provisoria-1", newPassword: "uma-senha-nova-bem-longa" });

      const after = await prisma.user.findUniqueOrThrow({ where: { id: staff.user.id } });
      expect(after.mustChangePassword).toBe(false);
      expect(await verifyPassword("uma-senha-nova-bem-longa", after.passwordHash)).toBe(true);
      expect(await verifyPassword("Provisoria-1", after.passwordHash)).toBe(false);
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "PASSWORD_CHANGED" } });
      expect(audit).toMatchObject({ userId: staff.user.id, companyId: company.id });
      expect(JSON.stringify(audit)).not.toContain("uma-senha-nova-bem-longa");
    });

    it("com a senha atual ERRADA: 422 e nada muda (a troca obrigatória continua)", async () => {
      const { company } = await setup();
      const staff = await person(company.id, "STAFF");
      const hash = await hashPassword("Provisoria-1");
      await prisma.user.update({ where: { id: staff.user.id }, data: { passwordHash: hash, mustChangePassword: true } });

      await expect(
        changeOwnPassword(staff.user.id, { currentPassword: "errada", newPassword: "uma-senha-nova-bem-longa" })
      ).rejects.toEqual(adminError(422));

      const after = await prisma.user.findUniqueOrThrow({ where: { id: staff.user.id } });
      expect(after.passwordHash).toBe(hash);
      expect(after.mustChangePassword).toBe(true);
    });

    it("conta desativada não troca senha", async () => {
      const { company } = await setup();
      const staff = await person(company.id, "STAFF");
      await prisma.user.update({ where: { id: staff.user.id }, data: { isActive: false } });

      await expect(
        changeOwnPassword(staff.user.id, { currentPassword: "x", newPassword: "uma-senha-nova-bem-longa" })
      ).rejects.toEqual(adminError(403));
    });
  });

  describe("listar a equipe", () => {
    it("só titular e administração; mostra o que quem olha pode fazer em cada linha", async () => {
      const { company, owner } = await setup();
      const admin = await person(company.id, "ADMIN");
      const staff = await person(company.id, "STAFF");

      const asAdmin = await listTeam({ actorId: admin.user.id, companyId: company.id });
      const byId = new Map(asAdmin.members.map((m) => [m.userId, m]));
      expect(asAdmin.assignableRoles).toEqual(["PRODUCER", "STAFF", "FREELANCER", "VIEWER"]);
      expect(byId.get(admin.user.id)).toMatchObject({ isSelf: true, canModify: false });
      expect(byId.get(owner.id)).toMatchObject({ isSelf: false, canModify: false });
      expect(byId.get(staff.user.id)).toMatchObject({ isSelf: false, canModify: true });

      const asOwner = await listTeam({ actorId: owner.id, companyId: company.id });
      expect(asOwner.assignableRoles).toHaveLength(6);
      expect(new Map(asOwner.members.map((m) => [m.userId, m])).get(admin.user.id)).toMatchObject({ canModify: true });

      for (const role of ["PRODUCER", "STAFF", "FREELANCER", "VIEWER"] as const) {
        const nobody = await person(company.id, role);
        await expect(listTeam({ actorId: nobody.user.id, companyId: company.id })).rejects.toEqual(adminError(403));
      }
    });

    it("não mostra nem deixa listar a equipe de OUTRA empresa", async () => {
      const { company } = await setup();
      const outra = await setup();
      await person(company.id, "STAFF");

      await expect(listTeam({ actorId: outra.owner.id, companyId: company.id })).rejects.toEqual(adminError(403));
      const own = await listTeam({ actorId: outra.owner.id, companyId: outra.company.id });
      expect(own.members).toHaveLength(1);
    });
  });
});
