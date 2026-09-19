/**
 * Criar/editar evento (integração — Postgres real, ver cabeçalho de sync-push.integration.test.ts).
 *
 * O que importa aqui: quem pode, o que fica registrado, duas pessoas editando ao mesmo tempo
 * nunca se sobrescrevem em silêncio, e a edição CHEGA aos aparelhos que já preparam o evento.
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
  truncateAll,
} from "../helpers/factories";
import {
  createEvent,
  EventForbiddenError,
  EventNotFoundError,
  EventVersionConflictError,
  getEventForEditing,
  updateEvent,
} from "@/server/events/event.service";
import { listAccessibleEvents } from "@/server/events/accessible-events";
import { pullChangesForEvent } from "@/server/sync/pull.service";

const prisma = createTestPrismaClient();

const input = {
  name: "Festival de Verão",
  description: "Três dias de música",
  location: "Parque da Cidade",
  startDate: "2026-12-01T12:00:00.000Z",
  endDate: "2026-12-03T23:00:00.000Z",
  status: "PLANNED" as const,
};

type CompanyRole = "OWNER" | "ADMIN" | "PRODUCER" | "STAFF" | "FREELANCER" | "VIEWER";

describe("criar e editar evento (integração — Postgres real)", () => {
  beforeEach(async () => {
    await truncateAll(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function setupCompany(role: CompanyRole = "PRODUCER") {
    const company = await createTestCompany(prisma);
    const user = await createTestUser(prisma);
    await createMembership(prisma, user.id, company.id, role);
    return { company, user };
  }

  /** Um evento já criado (pelo fluxo real), com o criador como gestor. */
  async function setupEvent() {
    const { company, user } = await setupCompany("PRODUCER");
    const event = await createEvent({ userId: user.id, companyId: company.id, input });
    return { company, manager: user, event };
  }

  /** Alguém com vínculo na empresa e um papel no evento. */
  async function personWithEventRole(
    companyId: string,
    eventId: string,
    eventRole: "MANAGER" | "FIELD_STAFF" | "VIEWER"
  ) {
    const person = await createTestUser(prisma);
    await createMembership(prisma, person.id, companyId, "STAFF");
    await grantEventAccess(prisma, person.id, eventId, eventRole);
    return person;
  }

  const editInput = (baseVersion: number, overrides: Record<string, unknown> = {}) => ({
    ...input,
    baseVersion,
    ...overrides,
  });

  describe("criar", () => {
    it.each<CompanyRole>(["OWNER", "ADMIN", "PRODUCER"])(
      "%s cria o evento na própria empresa, vira gestor dele e a criação é auditada",
      async (role) => {
        const { company, user } = await setupCompany(role);

        const event = await createEvent({ userId: user.id, companyId: company.id, input });

        expect(event).toMatchObject({
          companyId: company.id,
          name: "Festival de Verão",
          status: "PLANNED",
          version: 1,
          createdBy: user.id,
          updatedBy: user.id,
        });
        const access = await prisma.eventAccess.findUniqueOrThrow({
          where: { userId_eventId: { userId: user.id, eventId: event.id } },
        });
        expect(access).toMatchObject({ role: "MANAGER", status: "ACTIVE", grantedBy: user.id });
        const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: event.id, action: "CREATE" } });
        expect(audit).toMatchObject({ userId: user.id, companyId: company.id, eventId: event.id, entityType: "Event" });
      }
    );

    it.each<CompanyRole>(["STAFF", "FREELANCER", "VIEWER"])(
      "%s NÃO cria evento, e nada é gravado",
      async (role) => {
        const { company, user } = await setupCompany(role);

        await expect(createEvent({ userId: user.id, companyId: company.id, input })).rejects.toBeInstanceOf(
          EventForbiddenError
        );

        expect(await prisma.event.count()).toBe(0);
        expect(await prisma.eventAccess.count()).toBe(0);
        expect(await prisma.auditLog.count()).toBe(0);
      }
    );

    it("vínculo revogado com a empresa (mesmo com sessão ainda válida) não cria", async () => {
      const { company, user } = await setupCompany("OWNER");
      await prisma.membership.updateMany({
        where: { userId: user.id },
        data: { status: "REVOKED", revokedAt: new Date() },
      });

      await expect(createEvent({ userId: user.id, companyId: company.id, input })).rejects.toBeInstanceOf(
        EventForbiddenError
      );
    });

    it("conta desativada não cria", async () => {
      const { company, user } = await setupCompany("OWNER");
      await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });

      await expect(createEvent({ userId: user.id, companyId: company.id, input })).rejects.toBeInstanceOf(
        EventForbiddenError
      );
    });

    it("não cria evento em OUTRA empresa: ser dono de uma não dá poder sobre a outra", async () => {
      const { user } = await setupCompany("OWNER");
      const outra = await createTestCompany(prisma);

      await expect(createEvent({ userId: user.id, companyId: outra.id, input })).rejects.toBeInstanceOf(
        EventForbiddenError
      );
      expect(await prisma.event.count()).toBe(0);
    });

    it("descrição e local em branco viram 'sem valor', não string vazia gravada", async () => {
      const { company, user } = await setupCompany("OWNER");

      const event = await createEvent({
        userId: user.id,
        companyId: company.id,
        input: { ...input, description: "   ", location: "" },
      });

      expect(event.description).toBeNull();
      expect(event.location).toBeNull();
    });
  });

  describe("editar", () => {
    it("o gestor edita: a versão sobe, quem editou fica registrado e a auditoria guarda antes e depois", async () => {
      const { manager, event } = await setupEvent();

      const updated = await updateEvent({
        userId: manager.id,
        eventId: event.id,
        input: editInput(1, { name: "Festival de Verão 2026", status: "CONFIRMED" }),
      });

      expect(updated).toMatchObject({ name: "Festival de Verão 2026", status: "CONFIRMED", version: 2, updatedBy: manager.id });
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: event.id, action: "UPDATE" } });
      expect((audit.beforeJson as { name: string }).name).toBe("Festival de Verão");
      expect((audit.afterJson as { name: string }).name).toBe("Festival de Verão 2026");
      expect(audit.userId).toBe(manager.id);
    });

    it.each(["FIELD_STAFF", "VIEWER"] as const)(
      "%s do evento NÃO edita, e nada muda",
      async (eventRole) => {
        const { company, event } = await setupEvent();
        const person = await personWithEventRole(company.id, event.id, eventRole);

        await expect(
          updateEvent({ userId: person.id, eventId: event.id, input: editInput(1, { name: "Invasão" }) })
        ).rejects.toBeInstanceOf(EventForbiddenError);

        const after = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
        expect(after.name).toBe("Festival de Verão");
        expect(after.version).toBe(1);
      }
    );

    it("quem não tem acesso ao evento (nem é da empresa) recebe 'sem acesso', não 'não existe'", async () => {
      const { event } = await setupEvent();
      const intruder = await createTestUser(prisma);

      await expect(
        updateEvent({ userId: intruder.id, eventId: event.id, input: editInput(1) })
      ).rejects.toBeInstanceOf(EventForbiddenError);
    });

    it("gestor de OUTRA empresa não edita o evento (isolamento entre empresas)", async () => {
      const { event } = await setupEvent();
      const { company: outraEmpresa, user: outroGestor } = await setupCompany("OWNER");
      const outroEvento = await createEvent({ userId: outroGestor.id, companyId: outraEmpresa.id, input });

      await expect(
        updateEvent({ userId: outroGestor.id, eventId: event.id, input: editInput(1, { name: "Sequestrado" }) })
      ).rejects.toBeInstanceOf(EventForbiddenError);
      expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).name).toBe("Festival de Verão");
      expect(outroEvento.id).not.toBe(event.id);
    });

    it("gestor com acesso ao evento REVOGADO, ou com vínculo revogado na empresa, não edita", async () => {
      const { manager, event } = await setupEvent();

      await prisma.eventAccess.updateMany({ where: { userId: manager.id }, data: { status: "REVOKED", revokedAt: new Date() } });
      await expect(
        updateEvent({ userId: manager.id, eventId: event.id, input: editInput(1) })
      ).rejects.toBeInstanceOf(EventForbiddenError);

      await prisma.eventAccess.updateMany({ where: { userId: manager.id }, data: { status: "ACTIVE", revokedAt: null } });
      await prisma.membership.updateMany({ where: { userId: manager.id }, data: { status: "REVOKED", revokedAt: new Date() } });
      await expect(
        updateEvent({ userId: manager.id, eventId: event.id, input: editInput(1) })
      ).rejects.toBeInstanceOf(EventForbiddenError);
    });

    it("evento inexistente ou excluído: não encontrado", async () => {
      const { manager, event } = await setupEvent();

      await expect(
        updateEvent({ userId: manager.id, eventId: randomUUID(), input: editInput(1) })
      ).rejects.toBeInstanceOf(EventNotFoundError);

      await prisma.event.update({ where: { id: event.id }, data: { deletedAt: new Date() } });
      await expect(
        updateEvent({ userId: manager.id, eventId: event.id, input: editInput(1) })
      ).rejects.toBeInstanceOf(EventNotFoundError);
    });

    it("versão desatualizada (outra pessoa editou antes): 409 com o estado atual, e a edição da outra pessoa é preservada", async () => {
      const { company, manager, event } = await setupEvent();
      const second = await createTestUser(prisma);
      await createMembership(prisma, second.id, company.id, "PRODUCER");
      await grantEventAccess(prisma, second.id, event.id, "MANAGER");

      await updateEvent({ userId: second.id, eventId: event.id, input: editInput(1, { name: "Nome da outra pessoa" }) });

      const error = await updateEvent({
        userId: manager.id,
        eventId: event.id,
        input: editInput(1, { name: "Nome que ficou velho" }),
      }).catch((e) => e);

      expect(error).toBeInstanceOf(EventVersionConflictError);
      expect((error as EventVersionConflictError).current).toMatchObject({ name: "Nome da outra pessoa", version: 2 });
      const after = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
      expect(after).toMatchObject({ name: "Nome da outra pessoa", version: 2 });
    });

    it("duas edições SIMULTÂNEAS sobre a mesma versão: só uma vale, a outra recebe conflito", async () => {
      const { company, manager, event } = await setupEvent();
      const second = await createTestUser(prisma);
      await createMembership(prisma, second.id, company.id, "PRODUCER");
      await grantEventAccess(prisma, second.id, event.id, "MANAGER");

      const results = await Promise.allSettled([
        updateEvent({ userId: manager.id, eventId: event.id, input: editInput(1, { name: "Versão A" }) }),
        updateEvent({ userId: second.id, eventId: event.id, input: editInput(1, { name: "Versão B" }) }),
        updateEvent({ userId: manager.id, eventId: event.id, input: editInput(1, { name: "Versão C" }) }),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      for (const r of rejected) expect(r.reason).toBeInstanceOf(EventVersionConflictError);
      const after = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
      expect(after.version).toBe(2);
      expect(await prisma.auditLog.count({ where: { entityId: event.id, action: "UPDATE" } })).toBe(1);
    });

    it("salvar sem mudar nada não sobe a versão nem enche a auditoria (não faz todo aparelho baixar o evento à toa)", async () => {
      const { manager, event } = await setupEvent();

      const result = await updateEvent({ userId: manager.id, eventId: event.id, input: editInput(1) });

      expect(result.version).toBe(1);
      expect(await prisma.auditLog.count({ where: { entityId: event.id, action: "UPDATE" } })).toBe(0);
    });

    it("datas e situação também são editáveis (e a mudança de fuso/horário é preservada ao instante)", async () => {
      const { manager, event } = await setupEvent();

      const updated = await updateEvent({
        userId: manager.id,
        eventId: event.id,
        input: editInput(1, { startDate: "2026-12-02T15:30:00.000Z", endDate: "2026-12-04T01:00:00.000Z", status: "CANCELLED" }),
      });

      expect(updated.startDate.toISOString()).toBe("2026-12-02T15:30:00.000Z");
      expect(updated.endDate.toISOString()).toBe("2026-12-04T01:00:00.000Z");
      expect(updated.status).toBe("CANCELLED");
    });
  });

  describe("abrir a tela de edição", () => {
    it("só o gestor lê o evento para editar", async () => {
      const { company, manager, event } = await setupEvent();
      const viewer = await personWithEventRole(company.id, event.id, "VIEWER");

      expect((await getEventForEditing({ userId: manager.id, eventId: event.id })).id).toBe(event.id);
      await expect(getEventForEditing({ userId: viewer.id, eventId: event.id })).rejects.toBeInstanceOf(
        EventForbiddenError
      );
      await expect(getEventForEditing({ userId: manager.id, eventId: randomUUID() })).rejects.toBeInstanceOf(
        EventNotFoundError
      );
    });
  });

  describe("a edição chega aos aparelhos (pull)", () => {
    it("o pull devolve o evento atual — inclusive depois de editado, para quem já preparou o evento", async () => {
      // Regressão: só o bootstrap levava o evento. Depois da preparação, nome/datas/situação
      // editados nunca chegavam ao aparelho.
      const { manager, event } = await setupEvent();
      const before = await pullChangesForEvent(event.id, null, { userId: manager.id });
      expect(before.event).toMatchObject({ id: event.id, name: "Festival de Verão", version: 1 });

      await updateEvent({
        userId: manager.id,
        eventId: event.id,
        input: editInput(1, { name: "Festival Renomeado", status: "CANCELLED" }),
      });

      const after = await pullChangesForEvent(event.id, before.nextCursor, { userId: manager.id });
      expect(after.event).toMatchObject({ name: "Festival Renomeado", status: "CANCELLED", version: 2 });
      // Sem nenhuma mudança em tarefas etc.: o cursor não anda, mas o evento vem mesmo assim.
      expect(after.changes).toHaveLength(0);
    });

    it("acesso revogado: o pull não entrega o evento, só a revogação", async () => {
      const { company, event } = await setupEvent();
      const person = await personWithEventRole(company.id, event.id, "FIELD_STAFF");
      await prisma.eventAccess.updateMany({ where: { userId: person.id }, data: { status: "REVOKED", revokedAt: new Date() } });

      const response = await pullChangesForEvent(event.id, null, { userId: person.id });

      expect(response.accessRevoked).toBe(true);
      expect(response.event).toBeUndefined();
    });
  });

  describe("catálogo de eventos acessíveis", () => {
    it("lista os eventos com acesso ativo, em ordem de data", async () => {
      const { company, user } = await setupCompany("PRODUCER");
      const later = await createEvent({
        userId: user.id,
        companyId: company.id,
        input: { ...input, name: "Depois", startDate: "2027-01-01T12:00:00.000Z", endDate: "2027-01-02T12:00:00.000Z" },
      });
      const sooner = await createEvent({ userId: user.id, companyId: company.id, input: { ...input, name: "Antes" } });

      const rows = await listAccessibleEvents(user.id);

      expect(rows.map((r) => r.event.id)).toEqual([sooner.id, later.id]);
      expect(rows.every((r) => r.role === "MANAGER")).toBe(true);
    });

    it("vínculo revogado com a empresa esconde os eventos, mesmo com o acesso ao evento ainda ativo", async () => {
      // Regressão: o catálogo só olhava EventAccess; o Painel e a autorização olhavam também o
      // vínculo. A pessoa via na lista um evento que o servidor já recusava abrir.
      const { company, user } = await setupCompany("PRODUCER");
      const event = await createTestEvent(prisma, company.id);
      await grantEventAccess(prisma, user.id, event.id, "MANAGER");
      expect(await listAccessibleEvents(user.id)).toHaveLength(1);

      await prisma.membership.updateMany({ where: { userId: user.id }, data: { status: "REVOKED", revokedAt: new Date() } });

      expect(await listAccessibleEvents(user.id)).toHaveLength(0);
    });

    it("não mostra evento excluído nem de acesso revogado", async () => {
      const { company, user } = await setupCompany("PRODUCER");
      const excluded = await createTestEvent(prisma, company.id);
      const revoked = await createTestEvent(prisma, company.id);
      await grantEventAccess(prisma, user.id, excluded.id, "MANAGER");
      await grantEventAccess(prisma, user.id, revoked.id, "MANAGER");
      await prisma.event.update({ where: { id: excluded.id }, data: { deletedAt: new Date() } });
      await prisma.eventAccess.updateMany({ where: { eventId: revoked.id }, data: { status: "REVOKED" } });

      expect(await listAccessibleEvents(user.id)).toHaveLength(0);
    });
  });
});
