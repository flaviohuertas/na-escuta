/**
 * Fluxo de aprovação (integração — Postgres real, ver cabeçalho de sync-push.integration.test.ts).
 *
 * A equipe de campo PROPÕE uma correção nos dados do evento; o gestor APROVA (a mudança é aplicada
 * pelo mesmo caminho da edição direta) ou REJEITA (com o motivo). O que importa: só quem deve
 * propõe e decide; ninguém decide a própria proposta; aprovar nunca sobrescreve em silêncio uma
 * edição feita depois da proposta; duas decisões simultâneas nunca passam as duas; e o que falha
 * desfaz tudo (a proposta continua pendente).
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createMembership,
  createTestCompany,
  createTestPrismaClient,
  createTestUser,
  truncateAll,
} from "../helpers/factories";
import {
  countPendingForReview,
  decideProposal,
  listMyProposals,
  listProposalsForReview,
  proposeEventChange,
} from "@/server/approvals/approval.service";
import { createEvent, updateEvent } from "@/server/events/event.service";
import { grantEventAccess } from "@/server/events/event-access.service";

const prisma = createTestPrismaClient();

type CompanyRole = "OWNER" | "ADMIN" | "PRODUCER" | "STAFF" | "FREELANCER" | "VIEWER";

const EVENT = {
  name: "Festival do Parque",
  startDate: "2026-12-01T12:00:00.000Z",
  endDate: "2026-12-02T12:00:00.000Z",
  status: "PLANNED" as const,
};

const adminError = (status: number) => expect.objectContaining({ name: "AdminActionError", status });

describe("fluxo de aprovação (integração — Postgres real)", () => {
  beforeEach(async () => {
    await truncateAll(prisma);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function person(companyId: string, role: CompanyRole = "STAFF") {
    const user = await createTestUser(prisma);
    await createMembership(prisma, user.id, companyId, role);
    return user;
  }

  /** Uma empresa com um evento, seu gestor (o criador) e uma pessoa da equipe de campo. */
  async function setup() {
    const company = await createTestCompany(prisma);
    const manager = await person(company.id, "PRODUCER");
    const event = await createEvent({ userId: manager.id, companyId: company.id, input: EVENT });
    const field = await person(company.id);
    await grantEventAccess({ actorId: manager.id, eventId: event.id, userId: field.id, role: "FIELD_STAFF" });
    return { company, manager, event, field };
  }

  const propose = (userId: string, eventId: string, changes: Record<string, unknown>, reason?: string) =>
    proposeEventChange({ userId, input: { eventId, changes, reason } as never });

  const decide = (reviewerId: string, approvalId: string, decision: "APPROVE" | "REJECT", notes?: string) =>
    decideProposal({ reviewerId, approvalId, decision, notes });

  /** A edição direta do gestor, como a tela faz (todos os campos + versão). */
  async function directEdit(managerId: string, eventId: string, overrides: Record<string, unknown>) {
    const current = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
    return updateEvent({
      userId: managerId,
      eventId,
      input: {
        name: current.name,
        description: current.description,
        location: current.location,
        startDate: current.startDate.toISOString(),
        endDate: current.endDate.toISOString(),
        status: current.status as "PLANNED",
        baseVersion: current.version,
        ...overrides,
      },
    });
  }

  describe("propor", () => {
    it("a equipe de campo propõe: nasce pendente, guarda o que ela via e o que propõe, e o evento NÃO muda", async () => {
      const { manager, event, field } = await setup();

      const view = await propose(field.id, event.id, { name: "Festival do Parque 2026", location: "Praça Central" }, "O nome oficial mudou");

      expect(view).toMatchObject({ status: "PENDING", eventId: event.id, reason: "O nome oficial mudou", submittedBy: { id: field.id } });
      expect(view.changes.map((c) => [c.field, c.before, c.proposed])).toEqual([
        ["name", "Festival do Parque", "Festival do Parque 2026"],
        ["location", null, "Praça Central"],
      ]);
      const row = await prisma.pendingApproval.findUniqueOrThrow({ where: { id: view.id } });
      expect(row).toMatchObject({ companyId: event.companyId, entityType: "Event", entityId: event.id, status: "PENDING", reviewedByUserId: null });
      expect(row.proposedChangeJson).toMatchObject({ baseVersion: 1, after: { name: "Festival do Parque 2026", location: "Praça Central" } });
      expect(await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).toMatchObject({ name: "Festival do Parque", version: 1 });
      expect(await prisma.auditLog.findFirstOrThrow({ where: { action: "APPROVAL_SUBMITTED" } })).toMatchObject({ userId: field.id, entityId: row.id });
      void manager;
    });

    it("guarda só o que REALMENTE muda: campo que já é igual não é proposta", async () => {
      const { event, field } = await setup();

      const view = await propose(field.id, event.id, { name: "Festival do Parque", status: "CONFIRMED" });

      expect(view.changes.map((c) => c.field)).toEqual(["status"]);
    });

    it("se nada muda, recusa (422): o evento já está assim", async () => {
      const { event, field } = await setup();

      await expect(propose(field.id, event.id, { name: "Festival do Parque", startDate: "2026-12-01T12:00:00.000Z" })).rejects.toEqual(adminError(422));
      expect(await prisma.pendingApproval.count()).toBe(0);
    });

    it("texto opcional em branco vira 'sem valor' (null), como na edição direta", async () => {
      const { manager, event, field } = await setup();
      await directEdit(manager.id, event.id, { location: "Parque" });

      const view = await propose(field.id, event.id, { location: "   " });

      expect(view.changes[0]).toMatchObject({ field: "location", before: "Parque", proposed: null });
    });

    it("com só UMA das datas, confere contra a outra do evento: término antes do início é recusado (422)", async () => {
      const { event, field } = await setup();

      await expect(propose(field.id, event.id, { endDate: "2026-11-30T12:00:00.000Z" })).rejects.toEqual(adminError(422));
      await expect(propose(field.id, event.id, { startDate: "2026-12-05T12:00:00.000Z" })).rejects.toEqual(adminError(422));
      expect(await prisma.pendingApproval.count()).toBe(0);
    });

    describe("quem NÃO pode propor", () => {
      it("o gestor (edita direto), quem só visualiza e quem não tem acesso ao evento", async () => {
        const { company, manager, event } = await setup();
        const viewer = await person(company.id, "VIEWER");
        await grantEventAccess({ actorId: manager.id, eventId: event.id, userId: viewer.id, role: "VIEWER" });
        const stranger = await person(company.id);

        const asManager = await propose(manager.id, event.id, { name: "X" }).catch((e) => e);
        expect(asManager).toEqual(adminError(403));
        expect((asManager as Error).message).toMatch(/edite-o direto/);
        const asViewer = await propose(viewer.id, event.id, { name: "X" }).catch((e) => e);
        expect(asViewer).toEqual(adminError(403));
        expect((asViewer as Error).message).toMatch(/só de visualização/);
        await expect(propose(stranger.id, event.id, { name: "X" })).rejects.toEqual(adminError(403));
        expect(await prisma.pendingApproval.count()).toBe(0);
      });

      it("de outra empresa, com vínculo ou conta encerrados, ou em evento que não existe", async () => {
        const { company, manager, event, field } = await setup();
        const otherCompany = await createTestCompany(prisma);
        const outsider = await person(otherCompany.id);
        await expect(propose(outsider.id, event.id, { name: "X" })).rejects.toEqual(adminError(403));

        await expect(propose(field.id, "00000000-0000-4000-8000-000000000000", { name: "X" })).rejects.toEqual(adminError(404));

        // Revalidado no banco a cada chamada: o JWT da sessão continua válido depois de uma revogação.
        await prisma.membership.updateMany({ where: { userId: field.id, companyId: company.id }, data: { status: "REVOKED" } });
        await expect(propose(field.id, event.id, { name: "X" })).rejects.toEqual(adminError(403));
        await prisma.membership.updateMany({ where: { userId: field.id }, data: { status: "ACTIVE" } });
        await prisma.user.update({ where: { id: field.id }, data: { isActive: false } });
        await expect(propose(field.id, event.id, { name: "X" })).rejects.toEqual(adminError(403));
        await prisma.user.update({ where: { id: field.id }, data: { isActive: true } });
        await prisma.eventAccess.updateMany({ where: { userId: field.id, eventId: event.id }, data: { status: "REVOKED" } });
        await expect(propose(field.id, event.id, { name: "X" })).rejects.toEqual(adminError(403));
        void manager;
      });
    });

    describe("limite de propostas esperando decisão", () => {
      it("a mesma pessoa tem no máximo 5 pendentes por evento (409); as decididas não contam, as dos outros também não", async () => {
        const { company, manager, event, field } = await setup();
        const other = await person(company.id);
        await grantEventAccess({ actorId: manager.id, eventId: event.id, userId: other.id, role: "FIELD_STAFF" });
        const views = [];
        for (let i = 1; i <= 5; i++) views.push(await propose(field.id, event.id, { name: `Nome ${i}` }));

        const sixth = await propose(field.id, event.id, { name: "Nome 6" }).catch((e) => e);
        expect(sixth).toEqual(adminError(409));
        expect((sixth as Error).message).toMatch(/5 propostas esperando decisão/);

        await expect(propose(other.id, event.id, { name: "Do outro" })).resolves.toMatchObject({ status: "PENDING" });
        await decide(manager.id, views[0]!.id, "REJECT", "Não precisa");
        await expect(propose(field.id, event.id, { name: "Nome 6" })).resolves.toMatchObject({ status: "PENDING" });
      });

      it("propostas simultâneas não furam o limite (o evento é travado): 10 ao mesmo tempo → exatamente 5", async () => {
        const { event, field } = await setup();

        const results = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => propose(field.id, event.id, { name: `Nome ${i}` })));

        expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(5);
        expect(await prisma.pendingApproval.count({ where: { status: "PENDING" } })).toBe(5);
      });
    });
  });

  describe("aprovar", () => {
    it("aplica a mudança no evento pelo mesmo caminho da edição direta: versão sobe, quem decidiu fica como autor, histórico conta a história", async () => {
      const { manager, event, field } = await setup();
      const view = await propose(field.id, event.id, { name: "Festival do Parque 2026", endDate: "2026-12-03T12:00:00.000Z" });

      const decided = await decide(manager.id, view.id, "APPROVE", "Confere com o contrato");

      expect(decided).toMatchObject({ status: "APPROVED", reviewNotes: "Confere com o contrato", reviewedAt: expect.any(String) });
      const after = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
      expect(after).toMatchObject({ name: "Festival do Parque 2026", version: 2, updatedBy: manager.id });
      expect(after.endDate.toISOString()).toBe("2026-12-03T12:00:00.000Z");
      expect(after.startDate.toISOString()).toBe("2026-12-01T12:00:00.000Z"); // o que não foi proposto não mexe
      expect(await prisma.pendingApproval.findUniqueOrThrow({ where: { id: view.id } })).toMatchObject({ status: "APPROVED", reviewedByUserId: manager.id });

      const audit = await prisma.auditLog.findMany({ where: { eventId: event.id }, orderBy: { createdAt: "asc" } });
      const update = audit.find((a) => a.entityType === "Event" && a.action === "UPDATE" && (a.metadata as { approvalId?: string } | null)?.approvalId);
      expect(update).toMatchObject({ userId: manager.id, metadata: { approvalId: view.id, proposedBy: field.id } });
      expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["APPROVAL_SUBMITTED", "APPROVAL_APPROVED"]));
    });

    it("um campo esvaziado na proposta esvazia no evento (null), não vira string vazia", async () => {
      const { manager, event, field } = await setup();
      await directEdit(manager.id, event.id, { description: "Descrição antiga", location: "Parque" });
      const view = await propose(field.id, event.id, { description: "", location: null });

      await decide(manager.id, view.id, "APPROVE");

      expect(await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).toMatchObject({ description: null, location: null });
    });

    it("a edição feita em OUTRO campo depois da proposta não atrapalha: as duas ficam", async () => {
      // Conflito é por campo: exigir a versão inteira travaria qualquer proposta por uma vírgula alheia.
      const { manager, event, field } = await setup();
      const view = await propose(field.id, event.id, { name: "Nome novo" });
      await directEdit(manager.id, event.id, { location: "Local novo" });

      await decide(manager.id, view.id, "APPROVE");

      expect(await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).toMatchObject({ name: "Nome novo", location: "Local novo", version: 3 });
    });

    it("se o evento mudou NO MESMO campo depois da proposta: 409 dizendo qual, nada muda e a proposta continua pendente", async () => {
      // Regressão de desenho: aprovar por cima decide sobre um retrato velho e sobrescreve em silêncio a edição de outra pessoa.
      const { manager, event, field } = await setup();
      const view = await propose(field.id, event.id, { name: "Proposto pela equipe" });
      await directEdit(manager.id, event.id, { name: "Editado pelo gestor" });

      const error = await decide(manager.id, view.id, "APPROVE").catch((e) => e);

      expect(error).toEqual(adminError(409));
      expect((error as Error).message).toMatch(/Nome/);
      expect(await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).toMatchObject({ name: "Editado pelo gestor", version: 2 });
      expect(await prisma.pendingApproval.findUniqueOrThrow({ where: { id: view.id } })).toMatchObject({ status: "PENDING", reviewedByUserId: null, reviewedAt: null });
      // A tela sabe: o conflito aparece na proposta pendente.
      const { pending } = await listProposalsForReview(manager.id);
      expect(pending[0]).toMatchObject({ id: view.id, conflictFields: ["name"] });
      expect(pending[0]!.changes[0]).toMatchObject({ before: "Festival do Parque", current: "Editado pelo gestor", proposed: "Proposto pela equipe", conflict: true });
      // E rejeitar continua possível.
      await expect(decide(manager.id, view.id, "REJECT", "O gestor já mudou o nome")).resolves.toMatchObject({ status: "REJECTED" });
    });

    it("se o evento já ficou como a proposta quer, aprovar não escreve nada (a versão não sobe)", async () => {
      const { manager, event, field } = await setup();
      const view = await propose(field.id, event.id, { name: "Nome novo" });
      await directEdit(manager.id, event.id, { name: "Nome novo" }); // o gestor chegou lá por conta própria
      const versionBefore = (await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).version;

      const decided = await decide(manager.id, view.id, "APPROVE");

      expect(decided.status).toBe("APPROVED");
      expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).version).toBe(versionBefore);
    });

    it("se, por edições em outros campos, as datas ficariam invertidas: 409 e nada muda", async () => {
      const { manager, event, field } = await setup();
      const view = await propose(field.id, event.id, { startDate: "2026-12-02T00:00:00.000Z" }); // válido contra o término de agora
      await directEdit(manager.id, event.id, { endDate: "2026-12-01T18:00:00.000Z" }); // o gestor encurta o evento

      await expect(decide(manager.id, view.id, "APPROVE")).rejects.toEqual(adminError(409));

      expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).startDate.toISOString()).toBe("2026-12-01T12:00:00.000Z");
      expect((await prisma.pendingApproval.findUniqueOrThrow({ where: { id: view.id } })).status).toBe("PENDING");
    });

    it("evento excluído entre a proposta e a decisão: 409, a proposta continua pendente", async () => {
      const { manager, event, field } = await setup();
      const view = await propose(field.id, event.id, { name: "Nome novo" });
      await prisma.event.update({ where: { id: event.id }, data: { deletedAt: new Date() } });

      // Sem o evento, o gestor nem passa da autorização (404): a proposta some da vista dele.
      await expect(decide(manager.id, view.id, "APPROVE")).rejects.toEqual(adminError(404));
      expect((await prisma.pendingApproval.findUniqueOrThrow({ where: { id: view.id } })).status).toBe("PENDING");
    });
  });

  describe("rejeitar", () => {
    it("guarda o motivo, não toca no evento e registra no histórico", async () => {
      const { manager, event, field } = await setup();
      const view = await propose(field.id, event.id, { name: "Nome novo" });

      const decided = await decide(manager.id, view.id, "REJECT", "O nome oficial só muda depois da assembleia");

      expect(decided).toMatchObject({ status: "REJECTED", reviewNotes: "O nome oficial só muda depois da assembleia", reviewedByName: expect.any(String) });
      expect(await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).toMatchObject({ name: "Festival do Parque", version: 1 });
      expect(await prisma.auditLog.findFirstOrThrow({ where: { action: "APPROVAL_REJECTED" } })).toMatchObject({ userId: manager.id, entityId: view.id });
      expect(await prisma.auditLog.count({ where: { entityType: "Event", action: "UPDATE" } })).toBe(0);
    });

    it("exige o motivo (422): quem propôs precisa saber o que corrigir na próxima", async () => {
      const { manager, event, field } = await setup();
      const view = await propose(field.id, event.id, { name: "Nome novo" });

      for (const notes of [undefined, "", "  ", "ok"]) {
        await expect(decide(manager.id, view.id, "REJECT", notes), String(notes)).rejects.toEqual(adminError(422));
      }
      expect((await prisma.pendingApproval.findUniqueOrThrow({ where: { id: view.id } })).status).toBe("PENDING");
    });
  });

  describe("quem pode decidir", () => {
    it("a equipe de campo e quem só visualiza NÃO decidem (403)", async () => {
      const { company, manager, event, field } = await setup();
      const viewer = await person(company.id, "VIEWER");
      await grantEventAccess({ actorId: manager.id, eventId: event.id, userId: viewer.id, role: "VIEWER" });
      const view = await propose(field.id, event.id, { name: "Nome novo" });

      await expect(decide(viewer.id, view.id, "APPROVE")).rejects.toEqual(adminError(403));
      const fieldColleague = await person(company.id);
      await grantEventAccess({ actorId: manager.id, eventId: event.id, userId: fieldColleague.id, role: "FIELD_STAFF" });
      await expect(decide(fieldColleague.id, view.id, "APPROVE")).rejects.toEqual(adminError(403));
      expect((await prisma.pendingApproval.findUniqueOrThrow({ where: { id: view.id } })).status).toBe("PENDING");
    });

    it("quem propôs não decide a própria proposta, nem depois de virar gestor — outro gestor decide", async () => {
      const { manager, event, field } = await setup();
      const view = await propose(field.id, event.id, { name: "Nome novo" });
      await prisma.eventAccess.updateMany({ where: { userId: field.id, eventId: event.id }, data: { role: "MANAGER" } });

      const own = await decide(field.id, view.id, "APPROVE").catch((e) => e);
      expect(own).toEqual(adminError(403));
      expect((own as Error).message).toMatch(/própria proposta/);
      expect((await prisma.pendingApproval.findUniqueOrThrow({ where: { id: view.id } })).status).toBe("PENDING");

      await expect(decide(manager.id, view.id, "APPROVE")).resolves.toMatchObject({ status: "APPROVED" });
    });

    it("quem não tem acesso ao evento, de outra empresa, com vínculo ou acesso retirados: 404 (nem revela que existe proposta)", async () => {
      const { company, manager, event, field } = await setup();
      const view = await propose(field.id, event.id, { name: "Nome novo" });
      const otherCompany = await createTestCompany(prisma);
      const otherManager = await person(otherCompany.id, "PRODUCER");
      const otherEvent = await createEvent({ userId: otherManager.id, companyId: otherCompany.id, input: EVENT });
      const stranger = await person(company.id, "PRODUCER");

      await expect(decide(otherManager.id, view.id, "APPROVE")).rejects.toEqual(adminError(404));
      await expect(decide(stranger.id, view.id, "APPROVE")).rejects.toEqual(adminError(404));
      await expect(decide(manager.id, "00000000-0000-4000-8000-000000000000", "APPROVE")).rejects.toEqual(adminError(404));
      // Gestor de OUTRO evento não decide proposta deste.
      expect(otherEvent.id).not.toBe(event.id);

      await prisma.membership.updateMany({ where: { userId: manager.id }, data: { status: "REVOKED" } });
      await expect(decide(manager.id, view.id, "APPROVE")).rejects.toEqual(adminError(404));
      expect((await prisma.pendingApproval.findUniqueOrThrow({ where: { id: view.id } })).status).toBe("PENDING");
    });

    it("proposta de tipo desconhecido ou com JSON corrompido nunca é aplicada; corrompida ainda pode ser rejeitada", async () => {
      const { manager, event, field } = await setup();
      const make = (entityType: string, json: unknown) =>
        prisma.pendingApproval.create({
          data: { companyId: event.companyId, eventId: event.id, entityType, entityId: event.id, proposedChangeJson: json as never, submittedByUserId: field.id },
        });
      const unknown = await make("Orcamento", { total: 100 });
      const broken = await make("Event", { after: { name: "x" } }); // sem baseVersion/before
      const injected = await make("Event", { baseVersion: 1, before: {}, after: { version: "999", companyId: "outra" }, reason: null });

      await expect(decide(manager.id, unknown.id, "APPROVE")).rejects.toEqual(adminError(422));
      await expect(decide(manager.id, broken.id, "APPROVE")).rejects.toEqual(adminError(422));
      await expect(decide(manager.id, injected.id, "APPROVE")).rejects.toEqual(adminError(422));
      expect(await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).toMatchObject({ version: 1, name: "Festival do Parque" });
      expect(await prisma.pendingApproval.count({ where: { status: "PENDING" } })).toBe(3);

      const { pending } = await listProposalsForReview(manager.id);
      expect(pending.find((p) => p.id === broken.id)).toMatchObject({ unreadable: true, changes: [] });
      await expect(decide(manager.id, broken.id, "REJECT", "Proposta corrompida")).resolves.toMatchObject({ status: "REJECTED" });
    });
  });

  describe("concorrência", () => {
    it("decisões simultâneas sobre a MESMA proposta: só uma vale, as outras recebem 409 e a versão sobe UMA vez (8 rodadas)", async () => {
      // Sem a reivindicação atômica, todas passavam pela checagem "ainda pendente" e aplicavam várias
      // vezes. As corridas precisam de várias rodadas: com uma só o intercalamento pode não acontecer.
      for (let round = 0; round < 8; round++) {
        await truncateAll(prisma);
        const { company, manager, event, field } = await setup();
        const second = await person(company.id, "PRODUCER");
        await grantEventAccess({ actorId: manager.id, eventId: event.id, userId: second.id, role: "MANAGER" });
        const view = await propose(field.id, event.id, { name: `Nome ${round}` });

        const results = await Promise.allSettled([
          decide(manager.id, view.id, "APPROVE"),
          decide(second.id, view.id, "APPROVE"),
          decide(manager.id, view.id, "REJECT", "Não"),
          decide(second.id, view.id, "REJECT", "Não"),
        ]);

        const winners = results.filter((r) => r.status === "fulfilled");
        expect(winners, `rodada ${round}`).toHaveLength(1);
        for (const r of results) {
          if (r.status === "rejected") expect(r.reason).toEqual(adminError(409));
        }
        const finalRow = await prisma.pendingApproval.findUniqueOrThrow({ where: { id: view.id } });
        const finalEvent = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
        // O estado final é o do vencedor: aprovado aplica UMA vez; rejeitado não toca no evento.
        if (finalRow.status === "APPROVED") expect(finalEvent).toMatchObject({ name: `Nome ${round}`, version: 2 });
        else expect(finalEvent).toMatchObject({ name: "Festival do Parque", version: 1 });
        expect(await prisma.auditLog.count({ where: { action: { in: ["APPROVAL_APPROVED", "APPROVAL_REJECTED"] } } })).toBe(1);
      }
    });

    it("aprovação x edição direta ao mesmo tempo: nenhuma das duas some em silêncio (8 rodadas)", async () => {
      for (let round = 0; round < 8; round++) {
        await truncateAll(prisma);
        const { manager, event, field } = await setup();
        const view = await propose(field.id, event.id, { name: "Nome aprovado" });
        const base = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });

        const [approval, edit] = await Promise.allSettled([
          decide(manager.id, view.id, "APPROVE"),
          updateEvent({
            userId: manager.id,
            eventId: event.id,
            input: {
              name: base.name,
              description: null,
              location: "Local editado",
              startDate: base.startDate.toISOString(),
              endDate: base.endDate.toISOString(),
              status: "PLANNED",
              baseVersion: base.version,
            },
          }),
        ]);

        const final = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
        // O que foi confirmado ao usuário está no evento — nunca uma confirmação seguida de perda.
        if (approval.status === "fulfilled") expect(final.name, `rodada ${round}`).toBe("Nome aprovado");
        if (edit.status === "fulfilled") expect(final.location, `rodada ${round}`).toBe("Local editado");
        // E pelo menos uma das duas valeu; a que perdeu foi avisada (409), não engolida.
        expect(approval.status === "fulfilled" || edit.status === "fulfilled").toBe(true);
        for (const r of [approval, edit]) {
          if (r.status === "rejected") expect(r.reason.name === "AdminActionError" || r.reason.constructor.name === "EventVersionConflictError").toBe(true);
        }
      }
    });
  });

  describe("listas e contagem", () => {
    it("o gestor vê as pendentes (mais antigas primeiro) e as últimas decididas; nunca as próprias nem as de outra empresa", async () => {
      const { company, manager, event, field } = await setup();
      const first = await propose(field.id, event.id, { name: "A" });
      const second = await propose(field.id, event.id, { name: "B" });
      const third = await propose(field.id, event.id, { name: "C" });
      await decide(manager.id, third.id, "REJECT", "Não vale");
      const otherCompany = await createTestCompany(prisma);
      const otherManager = await person(otherCompany.id, "PRODUCER");
      const otherEvent = await createEvent({ userId: otherManager.id, companyId: otherCompany.id, input: EVENT });
      const otherField = await person(otherCompany.id);
      await grantEventAccess({ actorId: otherManager.id, eventId: otherEvent.id, userId: otherField.id, role: "FIELD_STAFF" });
      await propose(otherField.id, otherEvent.id, { name: "De outra empresa" });

      const mine = await listProposalsForReview(manager.id);

      expect(mine.pending.map((p) => p.id)).toEqual([first.id, second.id]);
      expect(mine.decided.map((p) => p.id)).toEqual([third.id]);
      expect(mine.decided[0]).toMatchObject({ status: "REJECTED", reviewNotes: "Não vale", conflictFields: [] });
      expect(await countPendingForReview(manager.id)).toBe(2);
      expect(await countPendingForReview(otherManager.id)).toBe(1);
      // Quem só faz parte da equipe de campo não é revisor de nada.
      expect(await listProposalsForReview(field.id)).toEqual({ pending: [], decided: [] });
      expect(await countPendingForReview(field.id)).toBe(0);
      void company;
    });

    it("um gestor que também propôs (por ter sido campo antes) não vê a própria proposta na fila de decisão", async () => {
      const { manager, event, field } = await setup();
      const own = await propose(field.id, event.id, { name: "Minha" });
      await prisma.eventAccess.updateMany({ where: { userId: field.id, eventId: event.id }, data: { role: "MANAGER" } });

      expect((await listProposalsForReview(field.id)).pending).toEqual([]);
      expect(await countPendingForReview(field.id)).toBe(0);
      expect((await listProposalsForReview(manager.id)).pending.map((p) => p.id)).toEqual([own.id]);
    });

    it("quem propôs vê as suas — pendentes e decididas, com o motivo da rejeição — e perde as de eventos aos quais não tem mais acesso", async () => {
      const { manager, event, field } = await setup();
      const a = await propose(field.id, event.id, { name: "A" });
      const b = await propose(field.id, event.id, { name: "B" });
      await decide(manager.id, b.id, "REJECT", "Não é o nome oficial");

      const mine = await listMyProposals(field.id);

      expect(mine.map((p) => [p.id, p.status])).toEqual([[b.id, "REJECTED"], [a.id, "PENDING"]]);
      expect(mine[0]).toMatchObject({ reviewNotes: "Não é o nome oficial", reviewedByName: expect.any(String) });
      expect(await listMyProposals(manager.id)).toEqual([]); // gestor não propôs nada

      await prisma.eventAccess.updateMany({ where: { userId: field.id, eventId: event.id }, data: { status: "REVOKED" } });
      expect(await listMyProposals(field.id)).toEqual([]);
    });

    it("as decididas são limitadas às 20 mais recentes", async () => {
      const { manager, event, field } = await setup();
      for (let i = 0; i < 22; i++) {
        const view = await propose(field.id, event.id, { name: `Nome ${i}` });
        await decide(manager.id, view.id, "REJECT", `Motivo ${i}`);
      }

      const { decided } = await listProposalsForReview(manager.id);

      expect(decided).toHaveLength(20);
      expect(decided[0]!.reviewNotes).toBe("Motivo 21");
    });
  });
});
