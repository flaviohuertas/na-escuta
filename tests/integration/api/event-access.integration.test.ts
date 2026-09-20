/**
 * Acesso ao evento (integração — Postgres real, ver cabeçalho de sync-push.integration.test.ts).
 *
 * O que importa: só o gestor do evento mexe; nunca se dá acesso a quem não é da empresa; o evento
 * nunca fica sem gestor (nem com dois gestores se tirando ao mesmo tempo); e a revogação vale
 * de fato para quem já está com o app aberto.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createMembership,
  createTestCompany,
  createTestPrismaClient,
  createTestUser,
  grantEventAccess,
  truncateAll,
} from "../helpers/factories";
import { createEvent, EventForbiddenError, EventNotFoundError } from "@/server/events/event.service";
import { listAccessibleEvents } from "@/server/events/accessible-events";
import { changeEventAccess, grantEventAccess as grantAccess, listEventAccess } from "@/server/events/event-access.service";
import { AdminActionError } from "@/server/errors";
import { authorizeEventAccess } from "@/server/sync/authorize";
import { pullChangesForEvent } from "@/server/sync/pull.service";

const prisma = createTestPrismaClient();

const eventInput = {
  name: "Festival",
  startDate: "2026-12-01T12:00:00.000Z",
  endDate: "2026-12-02T12:00:00.000Z",
  status: "PLANNED" as const,
};

type CompanyRole = "OWNER" | "ADMIN" | "PRODUCER" | "STAFF" | "FREELANCER" | "VIEWER";

describe("acesso ao evento (integração — Postgres real)", () => {
  beforeEach(async () => {
    await truncateAll(prisma);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function setup() {
    const company = await createTestCompany(prisma);
    const manager = await createTestUser(prisma);
    await createMembership(prisma, manager.id, company.id, "PRODUCER");
    const event = await createEvent({ userId: manager.id, companyId: company.id, input: eventInput });
    return { company, manager, event };
  }

  async function member(companyId: string, role: CompanyRole = "STAFF") {
    const user = await createTestUser(prisma);
    await createMembership(prisma, user.id, companyId, role);
    return user;
  }

  const adminError = (status: number) => expect.objectContaining({ name: "AdminActionError", status });

  describe("quem pode mexer", () => {
    it("só o gestor do evento lista e concede; equipe de campo, visualização e estranhos são recusados", async () => {
      const { company, manager, event } = await setup();
      const field = await member(company.id);
      const viewer = await member(company.id);
      const stranger = await createTestUser(prisma);
      const target = await member(company.id);
      await grantEventAccess(prisma, field.id, event.id, "FIELD_STAFF");
      await grantEventAccess(prisma, viewer.id, event.id, "VIEWER");

      for (const actor of [field, viewer, stranger]) {
        await expect(listEventAccess({ actorId: actor.id, eventId: event.id })).rejects.toBeInstanceOf(EventForbiddenError);
        await expect(
          grantAccess({ actorId: actor.id, eventId: event.id, userId: target.id, role: "VIEWER" })
        ).rejects.toBeInstanceOf(EventForbiddenError);
        await expect(
          changeEventAccess({ actorId: actor.id, eventId: event.id, userId: viewer.id, status: "REVOKED" })
        ).rejects.toBeInstanceOf(EventForbiddenError);
      }
      // Nada mudou.
      expect(await prisma.eventAccess.count({ where: { eventId: event.id } })).toBe(3);
      expect((await listEventAccess({ actorId: manager.id, eventId: event.id })).rows).toHaveLength(3);
    });

    it("gestor de OUTRA empresa não enxerga nem mexe (isolamento entre empresas)", async () => {
      const { event } = await setup();
      const other = await setup();

      await expect(listEventAccess({ actorId: other.manager.id, eventId: event.id })).rejects.toBeInstanceOf(
        EventForbiddenError
      );
      await expect(
        grantAccess({ actorId: other.manager.id, eventId: event.id, userId: other.manager.id, role: "MANAGER" })
      ).rejects.toBeInstanceOf(EventForbiddenError);
    });

    it("evento inexistente: não encontrado", async () => {
      const { manager } = await setup();
      await expect(listEventAccess({ actorId: manager.id, eventId: randomUUID() })).rejects.toBeInstanceOf(
        EventNotFoundError
      );
    });
  });

  describe("dar acesso", () => {
    it("concede a quem é da empresa, registra quem concedeu e audita", async () => {
      const { company, manager, event } = await setup();
      const person = await member(company.id);

      const access = await grantAccess({ actorId: manager.id, eventId: event.id, userId: person.id, role: "FIELD_STAFF" });

      expect(access).toMatchObject({ userId: person.id, eventId: event.id, role: "FIELD_STAFF", status: "ACTIVE", grantedBy: manager.id });
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: access.id, action: "ACCESS_GRANTED" } });
      expect(audit).toMatchObject({ userId: manager.id, eventId: event.id, companyId: company.id });
    });

    it.each([
      ["quem é de OUTRA empresa", async (companyId: string) => {
        const outra = await createTestCompany(prisma);
        const user = await createTestUser(prisma);
        await createMembership(prisma, user.id, outra.id, "OWNER");
        void companyId;
        return user;
      }],
      ["quem teve o vínculo com a empresa revogado", async (companyId: string) => {
        const user = await member(companyId);
        await prisma.membership.updateMany({ where: { userId: user.id }, data: { status: "REVOKED", revokedAt: new Date() } });
        return user;
      }],
      ["quem teve a conta desativada", async (companyId: string) => {
        const user = await member(companyId);
        await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
        return user;
      }],
    ])("recusa (422) dar acesso a %s — e nada é gravado", async (_label, makeUser) => {
      const { company, manager, event } = await setup();
      const target = await makeUser(company.id);

      await expect(
        grantAccess({ actorId: manager.id, eventId: event.id, userId: target.id, role: "VIEWER" })
      ).rejects.toEqual(adminError(422));

      expect(await prisma.eventAccess.count({ where: { userId: target.id } })).toBe(0);
    });

    it("dar acesso a quem já tem: 409", async () => {
      const { company, manager, event } = await setup();
      const person = await member(company.id);
      await grantAccess({ actorId: manager.id, eventId: event.id, userId: person.id, role: "VIEWER" });

      await expect(
        grantAccess({ actorId: manager.id, eventId: event.id, userId: person.id, role: "MANAGER" })
      ).rejects.toEqual(adminError(409));
    });

    it("dar acesso de novo a quem teve o acesso retirado reativa o MESMO registro, com o papel novo", async () => {
      const { company, manager, event } = await setup();
      const person = await member(company.id);
      const first = await grantAccess({ actorId: manager.id, eventId: event.id, userId: person.id, role: "VIEWER" });
      await changeEventAccess({ actorId: manager.id, eventId: event.id, userId: person.id, status: "REVOKED" });

      const again = await grantAccess({ actorId: manager.id, eventId: event.id, userId: person.id, role: "FIELD_STAFF" });

      expect(again.id).toBe(first.id);
      expect(again).toMatchObject({ role: "FIELD_STAFF", status: "ACTIVE", revokedAt: null });
      expect(await prisma.eventAccess.count({ where: { eventId: event.id, userId: person.id } })).toBe(1);
      expect(await prisma.auditLog.count({ where: { entityId: first.id, action: "ACCESS_REGRANTED" } })).toBe(1);
    });

    it("concessões simultâneas à mesma pessoa: só uma vale, sem registro duplicado nem erro de banco", async () => {
      // Várias rodadas: o intercalamento das transações depende de tempo, e uma rodada só
      // deixaria passar a falta da trava por evento (o segundo INSERT estoura a chave única).
      const { company, manager } = await setup();
      for (let round = 0; round < 8; round++) {
        const event = await createEvent({ userId: manager.id, companyId: company.id, input: eventInput });
        const person = await member(company.id);

        const results = await Promise.allSettled(
          Array.from({ length: 3 }, () =>
            grantAccess({ actorId: manager.id, eventId: event.id, userId: person.id, role: "VIEWER" })
          )
        );

        expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
        for (const r of results.filter((r): r is PromiseRejectedResult => r.status === "rejected")) {
          expect(r.reason).toEqual(adminError(409));
        }
        expect(await prisma.eventAccess.count({ where: { eventId: event.id, userId: person.id } })).toBe(1);
      }
    });
  });

  describe("mudar papel, retirar e reativar", () => {
    it("muda o papel, retira e reativa — cada passo auditado com antes e depois", async () => {
      const { company, manager, event } = await setup();
      const person = await member(company.id);
      await grantAccess({ actorId: manager.id, eventId: event.id, userId: person.id, role: "VIEWER" });

      const promoted = await changeEventAccess({ actorId: manager.id, eventId: event.id, userId: person.id, role: "FIELD_STAFF" });
      expect(promoted.role).toBe("FIELD_STAFF");

      const revoked = await changeEventAccess({ actorId: manager.id, eventId: event.id, userId: person.id, status: "REVOKED" });
      expect(revoked).toMatchObject({ status: "REVOKED" });
      expect(revoked.revokedAt).toBeInstanceOf(Date);

      const back = await changeEventAccess({ actorId: manager.id, eventId: event.id, userId: person.id, status: "ACTIVE" });
      expect(back).toMatchObject({ status: "ACTIVE", revokedAt: null, grantedBy: manager.id });

      const actions = (await prisma.auditLog.findMany({ where: { entityId: back.id }, orderBy: { createdAt: "asc" } })).map((a) => a.action);
      expect(actions).toEqual(["ACCESS_GRANTED", "ACCESS_ROLE_CHANGED", "ACCESS_REVOKED", "ACCESS_REACTIVATED"]);
      const revokeAudit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: back.id, action: "ACCESS_REVOKED" } });
      expect(revokeAudit.beforeJson).toMatchObject({ status: "ACTIVE" });
      expect(revokeAudit.afterJson).toMatchObject({ status: "REVOKED" });
    });

    it("não muda nada (nem audita) quando o pedido já é o que está gravado", async () => {
      const { company, manager, event } = await setup();
      const person = await member(company.id);
      await grantAccess({ actorId: manager.id, eventId: event.id, userId: person.id, role: "VIEWER" });
      const before = await prisma.auditLog.count({ where: { eventId: event.id } });

      await changeEventAccess({ actorId: manager.id, eventId: event.id, userId: person.id, role: "VIEWER" });

      expect(await prisma.auditLog.count({ where: { eventId: event.id } })).toBe(before);
    });

    it("pessoa sem registro de acesso: 404; mudar papel de acesso já retirado: 422", async () => {
      const { company, manager, event } = await setup();
      const person = await member(company.id);
      await expect(
        changeEventAccess({ actorId: manager.id, eventId: event.id, userId: person.id, role: "VIEWER" })
      ).rejects.toEqual(adminError(404));

      await grantAccess({ actorId: manager.id, eventId: event.id, userId: person.id, role: "VIEWER" });
      await changeEventAccess({ actorId: manager.id, eventId: event.id, userId: person.id, status: "REVOKED" });
      await expect(
        changeEventAccess({ actorId: manager.id, eventId: event.id, userId: person.id, role: "FIELD_STAFF" })
      ).rejects.toEqual(adminError(422));
    });

    it("reativar exige que a pessoa ainda seja da empresa", async () => {
      const { company, manager, event } = await setup();
      const person = await member(company.id);
      await grantAccess({ actorId: manager.id, eventId: event.id, userId: person.id, role: "VIEWER" });
      await changeEventAccess({ actorId: manager.id, eventId: event.id, userId: person.id, status: "REVOKED" });
      await prisma.membership.updateMany({ where: { userId: person.id }, data: { status: "REVOKED", revokedAt: new Date() } });

      await expect(
        changeEventAccess({ actorId: manager.id, eventId: event.id, userId: person.id, status: "ACTIVE" })
      ).rejects.toEqual(adminError(422));
    });
  });

  describe("o evento nunca fica sem gestor", () => {
    it("o único gestor não pode ser rebaixado nem retirado — nem por ele mesmo", async () => {
      const { manager, event } = await setup();

      await expect(
        changeEventAccess({ actorId: manager.id, eventId: event.id, userId: manager.id, role: "VIEWER" })
      ).rejects.toEqual(adminError(409));
      await expect(
        changeEventAccess({ actorId: manager.id, eventId: event.id, userId: manager.id, status: "REVOKED" })
      ).rejects.toEqual(adminError(409));

      const still = await prisma.eventAccess.findFirstOrThrow({ where: { userId: manager.id, eventId: event.id } });
      expect(still).toMatchObject({ role: "MANAGER", status: "ACTIVE" });
    });

    it("com um segundo gestor, o primeiro pode sair", async () => {
      const { company, manager, event } = await setup();
      const second = await member(company.id);
      await grantAccess({ actorId: manager.id, eventId: event.id, userId: second.id, role: "MANAGER" });

      const left = await changeEventAccess({ actorId: manager.id, eventId: event.id, userId: manager.id, status: "REVOKED" });

      expect(left.status).toBe("REVOKED");
    });

    it("um segundo gestor SEM vínculo ativo com a empresa não conta como gestor", async () => {
      const { company, manager, event } = await setup();
      const ghost = await member(company.id);
      await grantAccess({ actorId: manager.id, eventId: event.id, userId: ghost.id, role: "MANAGER" });
      await prisma.membership.updateMany({ where: { userId: ghost.id }, data: { status: "REVOKED", revokedAt: new Date() } });

      await expect(
        changeEventAccess({ actorId: manager.id, eventId: event.id, userId: manager.id, status: "REVOKED" })
      ).rejects.toEqual(adminError(409));
    });

    it("dois gestores se tirando AO MESMO TEMPO: só um sai e o evento continua com gestor", async () => {
      // Regressão: sem serializar por evento, os dois passam pela trava (cada um vê o outro como
      // "outro gestor") e o evento fica órfão.
      // Várias rodadas: o intercalamento depende de tempo (ver o teste de concessões simultâneas).
      const { company, manager } = await setup();
      for (let round = 0; round < 8; round++) {
        const event = await createEvent({ userId: manager.id, companyId: company.id, input: eventInput });
        const second = await member(company.id);
        await grantAccess({ actorId: manager.id, eventId: event.id, userId: second.id, role: "MANAGER" });

        const results = await Promise.allSettled([
          changeEventAccess({ actorId: manager.id, eventId: event.id, userId: second.id, status: "REVOKED" }),
          changeEventAccess({ actorId: second.id, eventId: event.id, userId: manager.id, status: "REVOKED" }),
        ]);

        expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
        const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
        expect(rejected).toHaveLength(1);
        expect(rejected[0]!.reason).toEqual(adminError(409));
        expect(
          await prisma.eventAccess.count({ where: { eventId: event.id, role: "MANAGER", status: "ACTIVE" } })
        ).toBe(1);
      }
    });
  });

  describe("a revogação vale de verdade", () => {
    it("quem teve o acesso retirado deixa de autorizar, de sincronizar e de ver o evento no catálogo", async () => {
      const { company, manager, event } = await setup();
      const person = await member(company.id);
      await grantAccess({ actorId: manager.id, eventId: event.id, userId: person.id, role: "FIELD_STAFF" });
      expect((await authorizeEventAccess({ userId: person.id }, event.id)).allowed).toBe(true);
      expect(await listAccessibleEvents(person.id)).toHaveLength(1);

      await changeEventAccess({ actorId: manager.id, eventId: event.id, userId: person.id, status: "REVOKED" });

      expect(await authorizeEventAccess({ userId: person.id }, event.id)).toMatchObject({
        allowed: false,
        reason: "EVENT_ACCESS_REVOKED",
      });
      const pull = await pullChangesForEvent(event.id, null, { userId: person.id });
      expect(pull).toMatchObject({ accessRevoked: true, revokedReason: "EVENT_ACCESS_REVOKED" });
      expect(pull.event).toBeUndefined();
      expect(await listAccessibleEvents(person.id)).toHaveLength(0);
    });

    it("conta DESATIVADA para de sincronizar mesmo com a sessão ainda válida (o sync não olhava isActive)", async () => {
      // Regressão: authorizeEventAccess só olhava vínculo e acesso; uma conta desativada com o
      // JWT ainda válido seguia lendo e gravando.
      const { company, manager, event } = await setup();
      const person = await member(company.id);
      await grantAccess({ actorId: manager.id, eventId: event.id, userId: person.id, role: "FIELD_STAFF" });
      await prisma.user.update({ where: { id: person.id }, data: { isActive: false } });

      expect(await authorizeEventAccess({ userId: person.id }, event.id)).toMatchObject({
        allowed: false,
        reason: "MEMBERSHIP_REVOKED",
      });
      expect(await listAccessibleEvents(person.id)).toHaveLength(0);
    });
  });

  describe("listar", () => {
    it("separa quem tem acesso de quem ainda pode ser convidado (só gente ativa da empresa, sem duplicar)", async () => {
      const { company, manager, event } = await setup();
      const active = await member(company.id, "STAFF");
      const revokedAccess = await member(company.id, "FREELANCER");
      const neverInvited = await member(company.id, "VIEWER");
      const revokedMember = await member(company.id);
      const inactiveUser = await member(company.id);
      const otherCompany = await createTestCompany(prisma);
      const outsider = await createTestUser(prisma);
      await createMembership(prisma, outsider.id, otherCompany.id, "OWNER");
      await grantAccess({ actorId: manager.id, eventId: event.id, userId: active.id, role: "FIELD_STAFF" });
      await grantAccess({ actorId: manager.id, eventId: event.id, userId: revokedAccess.id, role: "VIEWER" });
      await changeEventAccess({ actorId: manager.id, eventId: event.id, userId: revokedAccess.id, status: "REVOKED" });
      await prisma.membership.updateMany({ where: { userId: revokedMember.id }, data: { status: "REVOKED", revokedAt: new Date() } });
      await prisma.user.update({ where: { id: inactiveUser.id }, data: { isActive: false } });

      const { rows, candidates } = await listEventAccess({ actorId: manager.id, eventId: event.id });

      expect(rows.map((r) => r.userId).sort()).toEqual([manager.id, active.id, revokedAccess.id].sort());
      expect(rows.find((r) => r.userId === revokedAccess.id)).toMatchObject({ status: "REVOKED", membershipActive: true });
      // Convidáveis: quem nunca foi convidado E quem teve o acesso retirado; nunca quem já tem
      // acesso, quem saiu da empresa, quem está desativado ou é de outra empresa.
      expect(candidates.map((c) => c.userId).sort()).toEqual([neverInvited.id, revokedAccess.id].sort());
      expect(candidates.find((c) => c.userId === neverInvited.id)).toMatchObject({ companyRole: "VIEWER" });
    });
  });
});
