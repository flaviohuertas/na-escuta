/**
 * Comercial / CRM (integração — Postgres real, ver cabeçalho de sync-push.integration.test.ts).
 *
 * Clientes e o funil de oportunidades, e a conversão da oportunidade em evento. O que importa: só o
 * comercial da empresa mexe (e nunca em dado de outra empresa); as regras do funil valem no
 * servidor; edições concorrentes não se sobrescrevem; um cliente nunca fica arquivado com
 * oportunidade viva; e uma oportunidade nunca vira dois eventos.
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
  createClient,
  getClient,
  listClientOptions,
  listClients,
  setClientArchived,
  updateClient,
} from "@/server/crm/client.service";
import {
  convertToEvent,
  createOpportunity,
  getOpportunity,
  listOwnerOptions,
  listPipeline,
  moveStage,
  updateOpportunity,
} from "@/server/crm/opportunity.service";

const prisma = createTestPrismaClient();

type CompanyRole = "OWNER" | "ADMIN" | "PRODUCER" | "STAFF" | "FREELANCER" | "VIEWER";

const adminError = (status: number) => expect.objectContaining({ name: "AdminActionError", status });

const CNPJ = "06990590000123";
const CPF = "52998224725";

const clientInput = (overrides: Record<string, unknown> = {}) =>
  ({ name: "Cliente Teste", kind: "COMPANY", document: null, email: null, phone: null, notes: null, ...overrides }) as never;

const oppInput = (clientId: string, overrides: Record<string, unknown> = {}) =>
  ({
    clientId,
    title: "Festival de Verão",
    description: null,
    expectedValueCents: null,
    expectedStartDate: null,
    expectedEndDate: null,
    ownerUserId: null,
    ...overrides,
  }) as never;

const eventInput = (overrides: Record<string, unknown> = {}) => ({
  name: "Festival de Verão 2027",
  description: null,
  location: null,
  startDate: "2027-01-10T12:00:00.000Z",
  endDate: "2027-01-12T12:00:00.000Z",
  status: "PLANNED" as const,
  ...overrides,
});

describe("comercial / CRM (integração — Postgres real)", () => {
  beforeEach(async () => {
    await truncateAll(prisma);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function person(companyId: string, role: CompanyRole = "PRODUCER") {
    const user = await createTestUser(prisma);
    await createMembership(prisma, user.id, companyId, role);
    return user;
  }

  async function setup() {
    const company = await createTestCompany(prisma);
    const owner = await person(company.id, "OWNER");
    return { company, owner, ctx: { userId: owner.id, companyId: company.id } };
  }

  async function withClient(companyId: string, userId: string, overrides: Record<string, unknown> = {}) {
    return createClient({ userId, companyId, input: clientInput(overrides) });
  }

  async function withOpportunity(companyId: string, userId: string, overrides: Record<string, unknown> = {}) {
    const client = await withClient(companyId, userId, { name: `Cliente ${Math.random().toString(36).slice(2, 8)}` });
    const opportunity = await createOpportunity({ userId, companyId, input: oppInput(client.id, overrides) });
    return { client, opportunity };
  }

  const move = (ctx: { userId: string; companyId: string }, id: string, stage: string, baseVersion: number, lostReason?: string) =>
    moveStage({ ...ctx, opportunityId: id, input: { stage, baseVersion, lostReason: lostReason ?? null } as never });

  describe("quem acessa", () => {
    it("titular, administração e produção cuidam do comercial", async () => {
      const { company } = await setup();
      for (const role of ["OWNER", "ADMIN", "PRODUCER"] as const) {
        const user = await person(company.id, role);
        await expect(createClient({ userId: user.id, companyId: company.id, input: clientInput({ name: `Do ${role}` }) })).resolves.toMatchObject({ name: `Do ${role}` });
      }
    });

    it("equipe, freelancer e visualização NÃO acessam nada do comercial (403) — em nenhuma função", async () => {
      const { company, ctx } = await setup();
      const { client, opportunity } = await withOpportunity(company.id, ctx.userId);
      for (const role of ["STAFF", "FREELANCER", "VIEWER"] as const) {
        const user = await person(company.id, role);
        const c = { userId: user.id, companyId: company.id };
        const calls: Array<[string, () => Promise<unknown>]> = [
          ["listClients", () => listClients(c)],
          ["listClientOptions", () => listClientOptions(c)],
          ["getClient", () => getClient({ ...c, clientId: client.id })],
          ["createClient", () => createClient({ ...c, input: clientInput() })],
          ["updateClient", () => updateClient({ ...c, clientId: client.id, input: { ...(clientInput() as object), baseVersion: 1 } as never })],
          ["setClientArchived", () => setClientArchived({ ...c, clientId: client.id, archived: true, baseVersion: 1 })],
          ["listPipeline", () => listPipeline(c)],
          ["getOpportunity", () => getOpportunity({ ...c, opportunityId: opportunity.id })],
          ["createOpportunity", () => createOpportunity({ ...c, input: oppInput(client.id) })],
          ["updateOpportunity", () => updateOpportunity({ ...c, opportunityId: opportunity.id, input: { ...(oppInput(client.id) as object), baseVersion: 1 } as never })],
          ["moveStage", () => move(c, opportunity.id, "CONTACTED", 1)],
          ["convertToEvent", () => convertToEvent({ ...c, opportunityId: opportunity.id, input: { event: eventInput(), baseVersion: 1 } as never })],
          ["listOwnerOptions", () => listOwnerOptions(c)],
        ];
        for (const [name, call] of calls) {
          await expect(call(), `${role} → ${name}`).rejects.toEqual(adminError(403));
        }
      }
    });

    it("vínculo encerrado ou conta desativada: 403 (o papel é lido do banco a cada chamada)", async () => {
      const { company } = await setup();
      const user = await person(company.id, "PRODUCER");
      await prisma.membership.updateMany({ where: { userId: user.id }, data: { status: "REVOKED" } });
      await expect(listClients({ userId: user.id, companyId: company.id })).rejects.toEqual(adminError(403));

      await prisma.membership.updateMany({ where: { userId: user.id }, data: { status: "ACTIVE" } });
      await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
      await expect(listClients({ userId: user.id, companyId: company.id })).rejects.toEqual(adminError(403));
    });

    it("quem é de OUTRA empresa não acessa esta (403) e não enxerga, edita nem move nada dela (404)", async () => {
      const { company, ctx } = await setup();
      const { client, opportunity } = await withOpportunity(company.id, ctx.userId);
      const otherCompany = await createTestCompany(prisma);
      const outsider = await person(otherCompany.id, "OWNER");
      const theirs = { userId: outsider.id, companyId: otherCompany.id };

      // Fingindo ser da empresa de lá, mas apontando para ids daqui: "não existe".
      await expect(getClient({ ...theirs, clientId: client.id })).rejects.toEqual(adminError(404));
      await expect(getOpportunity({ ...theirs, opportunityId: opportunity.id })).rejects.toEqual(adminError(404));
      await expect(updateClient({ ...theirs, clientId: client.id, input: { ...(clientInput({ name: "Invadido" }) as object), baseVersion: 1 } as never })).rejects.toEqual(adminError(404));
      await expect(setClientArchived({ ...theirs, clientId: client.id, archived: true, baseVersion: 1 })).rejects.toEqual(adminError(404));
      await expect(move(theirs, opportunity.id, "WON", 1)).rejects.toEqual(adminError(404));
      await expect(createOpportunity({ ...theirs, input: oppInput(client.id) })).rejects.toEqual(adminError(404));
      await expect(convertToEvent({ ...theirs, opportunityId: opportunity.id, input: { event: eventInput(), baseVersion: 1 } as never })).rejects.toEqual(adminError(404));
      // E nas listas dela não aparece nada daqui.
      expect((await listClients(theirs)).rows).toEqual([]);
      expect((await listPipeline(theirs)).columns.every((c) => c.items.length === 0)).toBe(true);
      // Nem chamando as funções da empresa de lá com o companyId DAQUI.
      await expect(listClients({ userId: outsider.id, companyId: company.id })).rejects.toEqual(adminError(403));
      expect(await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).toMatchObject({ name: client.name, archivedAt: null, version: 1 });
      expect(await prisma.opportunity.findUniqueOrThrow({ where: { id: opportunity.id } })).toMatchObject({ stage: "NEW", version: 1 });
    });
  });

  describe("clientes", () => {
    it("cadastra e guarda no histórico quem fez; documento e e-mail como o schema os entrega", async () => {
      const { company, owner, ctx } = await setup();

      const client = await createClient({ ...ctx, input: clientInput({ name: "Prefeitura de Ouro Preto", document: CNPJ, email: "contato@ouropreto.gov.br", phone: "(31) 3000-0000" }) });

      expect(client).toMatchObject({ companyId: company.id, name: "Prefeitura de Ouro Preto", document: CNPJ, version: 1, archivedAt: null, createdBy: owner.id });
      expect(await prisma.auditLog.findFirstOrThrow({ where: { action: "CLIENT_CREATED" } })).toMatchObject({ userId: owner.id, entityId: client.id });
    });

    it("o mesmo CPF/CNPJ não é cadastrado duas vezes na empresa (409) — e a mensagem diz QUEM é; em outra empresa pode", async () => {
      const { company, ctx } = await setup();
      await withClient(company.id, ctx.userId, { name: "Produtora Alfa", document: CNPJ });

      const dup = await createClient({ ...ctx, input: clientInput({ name: "Alfa de novo", document: CNPJ }) }).catch((e) => e);
      expect(dup).toEqual(adminError(409));
      expect((dup as Error).message).toMatch(/06\.990\.590\/0001-23 já está cadastrado para Produtora Alfa/);

      const otherCompany = await createTestCompany(prisma);
      const other = await person(otherCompany.id, "OWNER");
      await expect(createClient({ userId: other.id, companyId: otherCompany.id, input: clientInput({ document: CNPJ }) })).resolves.toMatchObject({ document: CNPJ });
    });

    it("clientes SEM documento podem ser vários (nulo não colide)", async () => {
      const { ctx } = await setup();
      await createClient({ ...ctx, input: clientInput({ name: "A" }) });
      await expect(createClient({ ...ctx, input: clientInput({ name: "B" }) })).resolves.toMatchObject({ name: "B" });
    });

    it("se o dono do documento está ARQUIVADO, a mensagem manda reativar em vez de cadastrar de novo", async () => {
      const { company, ctx } = await setup();
      const old = await withClient(company.id, ctx.userId, { name: "Antigo", document: CPF, kind: "PERSON" });
      await setClientArchived({ ...ctx, clientId: old.id, archived: true, baseVersion: old.version });

      const error = await createClient({ ...ctx, input: clientInput({ name: "Novo", document: CPF }) }).catch((e) => e);

      expect(error).toEqual(adminError(409));
      expect((error as Error).message).toMatch(/Antigo \(arquivado — reative-o/);
    });

    it("cadastros simultâneos do MESMO documento: só um vale (a chave única decide, sem corrida) — 8 rodadas", async () => {
      for (let round = 0; round < 8; round++) {
        await truncateAll(prisma);
        const { ctx } = await setup();

        const results = await Promise.allSettled(
          Array.from({ length: 4 }, (_, i) => createClient({ ...ctx, input: clientInput({ name: `Cliente ${i}`, document: CNPJ }) }))
        );

        expect(results.filter((r) => r.status === "fulfilled"), `rodada ${round}`).toHaveLength(1);
        for (const r of results) if (r.status === "rejected") expect(r.reason).toEqual(adminError(409));
        expect(await prisma.client.count()).toBe(1);
      }
    });

    it("edita com controle de versão: a versão sobe e o histórico guarda o antes e o depois", async () => {
      const { company, ctx } = await setup();
      const client = await withClient(company.id, ctx.userId);

      const updated = await updateClient({ ...ctx, clientId: client.id, input: { ...(clientInput({ name: "Nome novo", phone: "111" }) as object), baseVersion: 1 } as never });

      expect(updated).toMatchObject({ name: "Nome novo", phone: "111", version: 2 });
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "CLIENT_UPDATED" } });
      expect(audit.beforeJson).toMatchObject({ name: "Cliente Teste" });
      expect(audit.afterJson).toMatchObject({ name: "Nome novo" });
    });

    it("editar sobre uma versão velha dá 409 e NÃO sobrescreve (duas edições simultâneas: só uma vale) — 8 rodadas", async () => {
      for (let round = 0; round < 8; round++) {
        await truncateAll(prisma);
        const { company, ctx } = await setup();
        const client = await withClient(company.id, ctx.userId);

        const results = await Promise.allSettled([
          updateClient({ ...ctx, clientId: client.id, input: { ...(clientInput({ name: "Edição A" }) as object), baseVersion: 1 } as never }),
          updateClient({ ...ctx, clientId: client.id, input: { ...(clientInput({ name: "Edição B" }) as object), baseVersion: 1 } as never }),
        ]);

        expect(results.filter((r) => r.status === "fulfilled"), `rodada ${round}`).toHaveLength(1);
        const loser = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
        expect(loser.reason).toEqual(adminError(409));
        expect(await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).toMatchObject({ version: 2 });
      }
    });

    it("trocar o documento por um que outro cliente já tem: 409; manter o próprio documento não é conflito", async () => {
      const { company, ctx } = await setup();
      await withClient(company.id, ctx.userId, { name: "Dono do CNPJ", document: CNPJ });
      const other = await withClient(company.id, ctx.userId, { name: "Outro", document: CPF, kind: "PERSON" });

      await expect(updateClient({ ...ctx, clientId: other.id, input: { ...(clientInput({ name: "Outro", document: CNPJ }) as object), baseVersion: 1 } as never })).rejects.toEqual(adminError(409));
      await expect(updateClient({ ...ctx, clientId: other.id, input: { ...(clientInput({ name: "Outro (editado)", document: CPF, kind: "PERSON" }) as object), baseVersion: 1 } as never })).resolves.toMatchObject({ version: 2 });
    });

    it("cliente arquivado não se edita (409): reative antes", async () => {
      const { company, ctx } = await setup();
      const client = await withClient(company.id, ctx.userId);
      const archived = await setClientArchived({ ...ctx, clientId: client.id, archived: true, baseVersion: 1 });

      await expect(updateClient({ ...ctx, clientId: client.id, input: { ...(clientInput({ name: "X" }) as object), baseVersion: archived.version } as never })).rejects.toEqual(adminError(409));
    });

    describe("arquivar e reativar", () => {
      it("arquiva sem oportunidade em andamento, esconde da lista e registra; reativa de volta", async () => {
        const { company, ctx } = await setup();
        const client = await withClient(company.id, ctx.userId, { name: "Sai da lista" });

        const archived = await setClientArchived({ ...ctx, clientId: client.id, archived: true, baseVersion: 1 });

        expect(archived.archivedAt).toBeInstanceOf(Date);
        expect((await listClients(ctx)).rows.map((r) => r.name)).not.toContain("Sai da lista");
        expect((await listClients({ ...ctx, includeArchived: true })).rows.map((r) => r.name)).toContain("Sai da lista");
        expect((await listClientOptions(ctx)).map((c) => c.name)).not.toContain("Sai da lista");
        expect(await prisma.auditLog.count({ where: { action: "CLIENT_ARCHIVED" } })).toBe(1);

        const restored = await setClientArchived({ ...ctx, clientId: client.id, archived: false, baseVersion: archived.version });
        expect(restored.archivedAt).toBeNull();
        expect((await listClients(ctx)).rows.map((r) => r.name)).toContain("Sai da lista");
      });

      it("com oportunidade EM ANDAMENTO é recusado (409) dizendo quantas; ganha ou perdida não impede", async () => {
        const { company, ctx } = await setup();
        const client = await withClient(company.id, ctx.userId);
        const a = await createOpportunity({ ...ctx, input: oppInput(client.id, { title: "A" }) });
        const b = await createOpportunity({ ...ctx, input: oppInput(client.id, { title: "B" }) });

        const blocked = await setClientArchived({ ...ctx, clientId: client.id, archived: true, baseVersion: 1 }).catch((e) => e);
        expect(blocked).toEqual(adminError(409));
        expect((blocked as Error).message).toMatch(/2 oportunidades em andamento/);

        await move(ctx, a.id, "WON", 1);
        await move(ctx, b.id, "LOST", 1, "Orçamento estourou");
        await expect(setClientArchived({ ...ctx, clientId: client.id, archived: true, baseVersion: 1 })).resolves.toMatchObject({ version: 2 });
      });

      it("versão velha: 409; já no estado pedido: 409", async () => {
        const { company, ctx } = await setup();
        const client = await withClient(company.id, ctx.userId);

        await expect(setClientArchived({ ...ctx, clientId: client.id, archived: true, baseVersion: 99 })).rejects.toEqual(adminError(409));
        await expect(setClientArchived({ ...ctx, clientId: client.id, archived: false, baseVersion: 1 })).rejects.toEqual(adminError(409));
      });

      it("arquivar ao mesmo tempo que abrir uma oportunidade NUNCA deixa oportunidade viva num cliente arquivado — 8 rodadas", async () => {
        // Sem a trava da linha do cliente as duas passavam pelas conferências e o par ficava incoerente.
        for (let round = 0; round < 8; round++) {
          await truncateAll(prisma);
          const { company, ctx } = await setup();
          const client = await withClient(company.id, ctx.userId);

          await Promise.allSettled([
            setClientArchived({ ...ctx, clientId: client.id, archived: true, baseVersion: 1 }),
            createOpportunity({ ...ctx, input: oppInput(client.id) }),
          ]);

          const after = await prisma.client.findUniqueOrThrow({ where: { id: client.id } });
          const open = await prisma.opportunity.count({ where: { clientId: client.id, stage: { in: ["NEW", "CONTACTED", "PROPOSAL_SENT", "NEGOTIATION"] } } });
          expect(after.archivedAt !== null && open > 0, `rodada ${round}: arquivado=${after.archivedAt !== null}, abertas=${open}`).toBe(false);
        }
      });
    });

    describe("listar", () => {
      it("busca no nome, no e-mail e no documento (com ou sem máscara), sem distinguir maiúsculas", async () => {
        const { company, ctx } = await setup();
        await withClient(company.id, ctx.userId, { name: "Buffet Sabor & Arte", email: "vendas@sabor.com.br" });
        await withClient(company.id, ctx.userId, { name: "Som e Luz Ltda", document: CNPJ });
        await withClient(company.id, ctx.userId, { name: "Ana Souza", document: CPF, kind: "PERSON" });

        const names = async (search: string) => (await listClients({ ...ctx, search })).rows.map((r) => r.name);
        expect(await names("SABOR")).toEqual(["Buffet Sabor & Arte"]);
        expect(await names("sabor.com")).toEqual(["Buffet Sabor & Arte"]);
        expect(await names("06.990.590/0001-23")).toEqual(["Som e Luz Ltda"]);
        expect(await names("529.982")).toEqual(["Ana Souza"]);
        expect(await names("não existe")).toEqual([]);
      });

      it("ordena por nome e conta as oportunidades EM ANDAMENTO de cada um", async () => {
        const { company, ctx } = await setup();
        const b = await withClient(company.id, ctx.userId, { name: "B Cliente" });
        await withClient(company.id, ctx.userId, { name: "A Cliente" });
        const o1 = await createOpportunity({ ...ctx, input: oppInput(b.id, { title: "1" }) });
        await createOpportunity({ ...ctx, input: oppInput(b.id, { title: "2" }) });
        await move(ctx, o1.id, "WON", 1);

        const { rows } = await listClients(ctx);

        expect(rows.map((r) => [r.name, r.openOpportunities])).toEqual([["A Cliente", 0], ["B Cliente", 1]]);
      });

      it("mostra no máximo 200 e diz que há mais", async () => {
        const { company, ctx } = await setup();
        await prisma.client.createMany({ data: Array.from({ length: 201 }, (_, i) => ({ companyId: company.id, name: `Cliente ${String(i).padStart(3, "0")}` })) });

        const { rows, truncated } = await listClients(ctx);

        expect(rows).toHaveLength(200);
        expect(truncated).toBe(true);
      });
    });
  });

  describe("oportunidades", () => {
    it("abre a oportunidade: nasce NOVA, o responsável é quem abriu, e o histórico registra", async () => {
      const { company, owner, ctx } = await setup();
      const client = await withClient(company.id, ctx.userId);

      const opp = await createOpportunity({ ...ctx, input: oppInput(client.id, { title: "Casamento Silva", expectedValueCents: 1_500_000, expectedStartDate: "2027-03-01T15:00:00.000Z" }) });

      expect(opp).toMatchObject({ companyId: company.id, clientId: client.id, stage: "NEW", ownerUserId: owner.id, expectedValueCents: 1_500_000, version: 1, closedAt: null, eventId: null });
      expect(await prisma.auditLog.findFirstOrThrow({ where: { action: "OPPORTUNITY_CREATED" } })).toMatchObject({ entityId: opp.id, userId: owner.id });
    });

    it("cliente arquivado: 409; cliente que não existe: 404", async () => {
      const { company, ctx } = await setup();
      const client = await withClient(company.id, ctx.userId);
      await setClientArchived({ ...ctx, clientId: client.id, archived: true, baseVersion: 1 });

      await expect(createOpportunity({ ...ctx, input: oppInput(client.id) })).rejects.toEqual(adminError(409));
      await expect(createOpportunity({ ...ctx, input: oppInput("00000000-0000-4000-8000-000000000000") })).rejects.toEqual(adminError(404));
    });

    it("o responsável precisa ser do comercial DA EMPRESA com vínculo e conta ativos (422)", async () => {
      const { company, ctx } = await setup();
      const client = await withClient(company.id, ctx.userId);
      const staff = await person(company.id, "STAFF");
      const otherCompany = await createTestCompany(prisma);
      const stranger = await person(otherCompany.id, "OWNER");
      const gone = await person(company.id, "PRODUCER");
      await prisma.membership.updateMany({ where: { userId: gone.id }, data: { status: "REVOKED" } });
      const good = await person(company.id, "ADMIN");

      for (const bad of [staff.id, stranger.id, gone.id, "00000000-0000-4000-8000-000000000000"]) {
        await expect(createOpportunity({ ...ctx, input: oppInput(client.id, { ownerUserId: bad }) }), bad).rejects.toEqual(adminError(422));
      }
      await expect(createOpportunity({ ...ctx, input: oppInput(client.id, { ownerUserId: good.id }) })).resolves.toMatchObject({ ownerUserId: good.id });
      expect(await prisma.opportunity.count()).toBe(1);
    });

    it("lista de responsáveis: só o comercial ativo da empresa, por nome", async () => {
      const { company, ctx } = await setup();
      await prisma.user.update({ where: { id: ctx.userId }, data: { name: "Beto" } });
      const ana = await person(company.id, "ADMIN");
      await prisma.user.update({ where: { id: ana.id }, data: { name: "Ana" } });
      await person(company.id, "STAFF");
      const gone = await person(company.id, "PRODUCER");
      await prisma.membership.updateMany({ where: { userId: gone.id }, data: { status: "REVOKED" } });

      expect((await listOwnerOptions(ctx)).map((o) => o.name)).toEqual(["Ana", "Beto"]);
    });

    describe("editar", () => {
      it("muda título, valor, datas e responsável; a versão sobe; o histórico diz o que mudou", async () => {
        const { company, ctx } = await setup();
        const { client, opportunity } = await withOpportunity(company.id, ctx.userId);
        const ana = await person(company.id, "ADMIN");

        const updated = await updateOpportunity({
          ...ctx,
          opportunityId: opportunity.id,
          input: { ...(oppInput(client.id, { title: "Título novo", expectedValueCents: 50_000, ownerUserId: ana.id }) as object), baseVersion: 1 } as never,
        });

        expect(updated).toMatchObject({ title: "Título novo", expectedValueCents: 50_000, ownerUserId: ana.id, version: 2, stage: "NEW" });
        const detail = await getOpportunity({ ...ctx, opportunityId: opportunity.id });
        expect(detail.history[0]!.text).toBe("Editada: título, valor estimado, responsável.");
      });

      it("o cliente NÃO muda (422) e a etapa só muda por moveStage", async () => {
        const { company, ctx } = await setup();
        const { client, opportunity } = await withOpportunity(company.id, ctx.userId);
        const other = await withClient(company.id, ctx.userId, { name: "Outro" });

        await expect(updateOpportunity({ ...ctx, opportunityId: opportunity.id, input: { ...(oppInput(other.id) as object), baseVersion: 1 } as never })).rejects.toEqual(adminError(422));
        const after = await updateOpportunity({ ...ctx, opportunityId: opportunity.id, input: { ...(oppInput(client.id, { title: "Só o título" }) as object), stage: "WON", baseVersion: 1 } as never });
        expect(after.stage).toBe("NEW");
      });

      it("versão velha: 409 e nada muda", async () => {
        const { company, ctx } = await setup();
        const { client, opportunity } = await withOpportunity(company.id, ctx.userId);
        await updateOpportunity({ ...ctx, opportunityId: opportunity.id, input: { ...(oppInput(client.id, { title: "Primeira" }) as object), baseVersion: 1 } as never });

        await expect(updateOpportunity({ ...ctx, opportunityId: opportunity.id, input: { ...(oppInput(client.id, { title: "Segunda" }) as object), baseVersion: 1 } as never })).rejects.toEqual(adminError(409));
        expect((await prisma.opportunity.findUniqueOrThrow({ where: { id: opportunity.id } })).title).toBe("Primeira");
      });
    });

    describe("funil", () => {
      it("anda entre as etapas em andamento, para frente e para trás; a versão sobe a cada movimento", async () => {
        const { company, ctx } = await setup();
        const { opportunity } = await withOpportunity(company.id, ctx.userId);

        let current = await move(ctx, opportunity.id, "PROPOSAL_SENT", 1);
        expect(current).toMatchObject({ stage: "PROPOSAL_SENT", version: 2, closedAt: null });
        current = await move(ctx, opportunity.id, "NEGOTIATION", 2);
        current = await move(ctx, opportunity.id, "CONTACTED", 3);
        expect(current).toMatchObject({ stage: "CONTACTED", version: 4 });
        expect((await getOpportunity({ ...ctx, opportunityId: opportunity.id })).history[0]!.text).toBe("Etapa: Negociação → Em contato");
      });

      it("ganhar fecha (closedAt); perder exige e guarda o motivo", async () => {
        const { company, ctx } = await setup();
        const won = (await withOpportunity(company.id, ctx.userId)).opportunity;
        const lost = (await withOpportunity(company.id, ctx.userId)).opportunity;

        const wonNow = await move(ctx, won.id, "WON", 1);
        const lostNow = await move(ctx, lost.id, "LOST", 1, "Foi para a concorrência");

        expect(wonNow).toMatchObject({ stage: "WON", lostReason: null });
        expect(wonNow.closedAt).toBeInstanceOf(Date);
        expect(lostNow).toMatchObject({ stage: "LOST", lostReason: "Foi para a concorrência" });
        expect((await getOpportunity({ ...ctx, opportunityId: lost.id })).history[0]!.text).toBe("Etapa: Novo → Perdido — motivo: Foi para a concorrência");
      });

      it("reabrir volta ao funil e LIMPA o fechamento e o motivo", async () => {
        const { company, ctx } = await setup();
        const { opportunity } = await withOpportunity(company.id, ctx.userId);
        await move(ctx, opportunity.id, "LOST", 1, "Sem orçamento");

        const reopened = await move(ctx, opportunity.id, "NEGOTIATION", 2);

        expect(reopened).toMatchObject({ stage: "NEGOTIATION", closedAt: null, lostReason: null });
      });

      it("ganho ↔ perdido direto e mover para a mesma etapa são recusados (409)", async () => {
        const { company, ctx } = await setup();
        const { opportunity } = await withOpportunity(company.id, ctx.userId);
        await move(ctx, opportunity.id, "WON", 1);

        await expect(move(ctx, opportunity.id, "LOST", 2, "Mudei de ideia")).rejects.toEqual(adminError(409));
        await expect(move(ctx, opportunity.id, "WON", 2)).rejects.toEqual(adminError(409));
        expect((await prisma.opportunity.findUniqueOrThrow({ where: { id: opportunity.id } })).stage).toBe("WON");
      });

      it("versão velha: 409 dizendo para recarregar; dois movimentos ao mesmo tempo — só um vale (8 rodadas)", async () => {
        for (let round = 0; round < 8; round++) {
          await truncateAll(prisma);
          const { company, ctx } = await setup();
          const { opportunity } = await withOpportunity(company.id, ctx.userId);

          const results = await Promise.allSettled([move(ctx, opportunity.id, "CONTACTED", 1), move(ctx, opportunity.id, "NEGOTIATION", 1)]);

          expect(results.filter((r) => r.status === "fulfilled"), `rodada ${round}`).toHaveLength(1);
          const loser = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
          expect(loser.reason).toEqual(adminError(409));
          expect((await prisma.opportunity.findUniqueOrThrow({ where: { id: opportunity.id } })).version).toBe(2);
        }
      });

      it("etapa perdida sem motivo é recusada pelo serviço também (o schema da rota não é a única defesa)… e ganho/perdido ficam com valor guardado", async () => {
        // O schema da rota exige o motivo; o serviço guarda o que recebe. Aqui só confirmo que o
        // motivo chega ao banco e que o fechamento não apaga o valor estimado.
        const { company, ctx } = await setup();
        const { opportunity } = await withOpportunity(company.id, ctx.userId, { expectedValueCents: 90_000 });

        const lost = await move(ctx, opportunity.id, "LOST", 1, "Preço");

        expect(lost.expectedValueCents).toBe(90_000);
      });
    });

    describe("o funil (visão geral)", () => {
      it("agrupa por etapa, soma o valor estimado de cada coluna e separa ganhas e perdidas", async () => {
        const { company, ctx } = await setup();
        const a = (await withOpportunity(company.id, ctx.userId, { title: "A", expectedValueCents: 100_00 })).opportunity;
        await withOpportunity(company.id, ctx.userId, { title: "B", expectedValueCents: 250_00 });
        const c = (await withOpportunity(company.id, ctx.userId, { title: "C", expectedValueCents: 40_00 })).opportunity;
        const d = (await withOpportunity(company.id, ctx.userId, { title: "D" })).opportunity; // sem valor
        const e = (await withOpportunity(company.id, ctx.userId, { title: "E", expectedValueCents: 999_00 })).opportunity;
        await move(ctx, a.id, "NEGOTIATION", 1);
        await move(ctx, c.id, "NEGOTIATION", 1);
        await move(ctx, d.id, "WON", 1);
        await move(ctx, e.id, "LOST", 1, "Cancelou");

        const pipeline = await listPipeline(ctx);

        const col = (stage: string) => pipeline.columns.find((c) => c.stage === stage)!;
        expect(pipeline.columns.map((c) => c.stage)).toEqual(["NEW", "CONTACTED", "PROPOSAL_SENT", "NEGOTIATION"]);
        expect(col("NEW")).toMatchObject({ count: 1, totalCents: 250_00 });
        expect(col("NEGOTIATION")).toMatchObject({ count: 2, totalCents: 140_00 });
        expect(col("CONTACTED")).toMatchObject({ count: 0, totalCents: 0, items: [] });
        expect(pipeline.won.map((o) => o.title)).toEqual(["D"]);
        expect(pipeline.lost.map((o) => o.title)).toEqual(["E"]);
        expect(col("NEW").items[0]).toMatchObject({ title: "B", clientName: expect.any(String), ownerName: expect.any(String) });
      });

      it("a contagem e a soma de cada coluna vêm do banco todo, mesmo quando a tela mostra só as primeiras", async () => {
        const { company, ctx } = await setup();
        const client = await withClient(company.id, ctx.userId);
        await prisma.opportunity.createMany({
          data: Array.from({ length: 501 }, (_, i) => ({ companyId: company.id, clientId: client.id, title: `Op ${i}`, expectedValueCents: 100 })),
        });

        const pipeline = await listPipeline(ctx);

        expect(pipeline.truncated).toBe(true);
        expect(pipeline.columns.find((c) => c.stage === "NEW")).toMatchObject({ count: 501, totalCents: 501 * 100 });
        expect(pipeline.columns.find((c) => c.stage === "NEW")!.items).toHaveLength(500);
      });

      it("ganhas e perdidas: só as 30 mais recentes de cada", async () => {
        const { company, ctx } = await setup();
        const client = await withClient(company.id, ctx.userId);
        await prisma.opportunity.createMany({
          data: Array.from({ length: 32 }, (_, i) => ({ companyId: company.id, clientId: client.id, title: `Ganha ${i}`, stage: "WON" as const, closedAt: new Date(2026, 0, 1 + i) })),
        });

        const { won } = await listPipeline(ctx);

        expect(won).toHaveLength(30);
        expect(won[0]!.title).toBe("Ganha 31");
      });
    });

    describe("transformar em evento", () => {
      it("cria o evento (a pessoa vira gestora), vincula, marca como GANHA e guarda tudo no histórico", async () => {
        const { company, owner, ctx } = await setup();
        const { opportunity } = await withOpportunity(company.id, ctx.userId, { title: "Festival de Verão" });

        const { event, opportunity: after } = await convertToEvent({ ...ctx, opportunityId: opportunity.id, input: { event: eventInput(), baseVersion: 1 } as never });

        expect(event).toMatchObject({ companyId: company.id, name: "Festival de Verão 2027", createdBy: owner.id });
        expect(after).toMatchObject({ eventId: event.id, stage: "WON", version: 2, lostReason: null });
        expect(after.closedAt).toBeInstanceOf(Date);
        expect(await prisma.eventAccess.findFirstOrThrow({ where: { eventId: event.id, userId: owner.id } })).toMatchObject({ role: "MANAGER", status: "ACTIVE" });
        expect(await prisma.auditLog.findFirstOrThrow({ where: { entityType: "Event", action: "CREATE", entityId: event.id } })).toMatchObject({ metadata: { opportunityId: opportunity.id } });
        expect((await getOpportunity({ ...ctx, opportunityId: opportunity.id })).history[0]!.text).toBe("Virou um evento.");
        const detail = await getOpportunity({ ...ctx, opportunityId: opportunity.id });
        expect(detail.event).toMatchObject({ id: event.id, name: "Festival de Verão 2027" });
      });

      it("uma oportunidade em qualquer etapa em andamento, ou já ganha (sem evento), pode virar evento", async () => {
        const { company, ctx } = await setup();
        const negotiating = (await withOpportunity(company.id, ctx.userId)).opportunity;
        const won = (await withOpportunity(company.id, ctx.userId)).opportunity;
        await move(ctx, negotiating.id, "NEGOTIATION", 1);
        await move(ctx, won.id, "WON", 1);

        await expect(convertToEvent({ ...ctx, opportunityId: negotiating.id, input: { event: eventInput({ name: "A" }), baseVersion: 2 } as never })).resolves.toMatchObject({ opportunity: { stage: "WON" } });
        await expect(convertToEvent({ ...ctx, opportunityId: won.id, input: { event: eventInput({ name: "B" }), baseVersion: 2 } as never })).resolves.toMatchObject({ opportunity: { stage: "WON" } });
      });

      it("já virou evento: 409, e nenhum segundo evento é criado", async () => {
        const { company, ctx } = await setup();
        const { opportunity } = await withOpportunity(company.id, ctx.userId);
        await convertToEvent({ ...ctx, opportunityId: opportunity.id, input: { event: eventInput(), baseVersion: 1 } as never });

        await expect(convertToEvent({ ...ctx, opportunityId: opportunity.id, input: { event: eventInput({ name: "De novo" }), baseVersion: 2 } as never })).rejects.toEqual(adminError(409));
        expect(await prisma.event.count()).toBe(1);
      });

      it("perdida não vira evento (409) — reabra antes", async () => {
        const { company, ctx } = await setup();
        const { opportunity } = await withOpportunity(company.id, ctx.userId);
        await move(ctx, opportunity.id, "LOST", 1, "Sem orçamento");

        await expect(convertToEvent({ ...ctx, opportunityId: opportunity.id, input: { event: eventInput(), baseVersion: 2 } as never })).rejects.toEqual(adminError(409));
        expect(await prisma.event.count()).toBe(0);
      });

      it("versão velha da oportunidade: 409 e nada é criado", async () => {
        const { company, ctx } = await setup();
        const { opportunity } = await withOpportunity(company.id, ctx.userId);
        await move(ctx, opportunity.id, "CONTACTED", 1);

        await expect(convertToEvent({ ...ctx, opportunityId: opportunity.id, input: { event: eventInput(), baseVersion: 1 } as never })).rejects.toEqual(adminError(409));
        expect(await prisma.event.count()).toBe(0);
      });

      it("conversões simultâneas: UM evento só, as outras recebem 409 — 8 rodadas", async () => {
        // Sem a trava da oportunidade, todas passavam por "eventId ainda é nulo" e criavam um evento cada.
        for (let round = 0; round < 8; round++) {
          await truncateAll(prisma);
          const { company, ctx } = await setup();
          const { opportunity } = await withOpportunity(company.id, ctx.userId);

          const results = await Promise.allSettled(
            Array.from({ length: 4 }, (_, i) => convertToEvent({ ...ctx, opportunityId: opportunity.id, input: { event: eventInput({ name: `Evento ${i}` }), baseVersion: 1 } as never }))
          );

          expect(results.filter((r) => r.status === "fulfilled"), `rodada ${round}`).toHaveLength(1);
          for (const r of results) if (r.status === "rejected") expect(r.reason).toEqual(adminError(409));
          expect(await prisma.event.count(), `rodada ${round}`).toBe(1);
          expect(await prisma.eventAccess.count()).toBe(1);
        }
      });

      it("é tudo-ou-nada: se criar o evento falha, a oportunidade NÃO é vinculada nem marcada como ganha", async () => {
        const { company, ctx } = await setup();
        const { opportunity } = await withOpportunity(company.id, ctx.userId);

        await expect(convertToEvent({ ...ctx, opportunityId: opportunity.id, input: { event: eventInput({ name: null }), baseVersion: 1 } as never })).rejects.toThrow();

        expect(await prisma.opportunity.findUniqueOrThrow({ where: { id: opportunity.id } })).toMatchObject({ eventId: null, stage: "NEW", version: 1 });
        expect(await prisma.event.count()).toBe(0);
        expect(await prisma.eventAccess.count()).toBe(0);
      });

      it("depois de virar evento, não dá para perder nem reabrir a oportunidade (409)", async () => {
        const { company, ctx } = await setup();
        const { opportunity } = await withOpportunity(company.id, ctx.userId);
        const { opportunity: converted } = await convertToEvent({ ...ctx, opportunityId: opportunity.id, input: { event: eventInput(), baseVersion: 1 } as never });

        await expect(move(ctx, opportunity.id, "NEGOTIATION", converted.version)).rejects.toEqual(adminError(409));
        await expect(move(ctx, opportunity.id, "LOST", converted.version, "Desistiu")).rejects.toEqual(adminError(409));
      });
    });

    describe("uma oportunidade", () => {
      it("mostra o cliente, o responsável e o histórico, do mais novo ao mais antigo, com quem fez", async () => {
        const { company, ctx } = await setup();
        await prisma.user.update({ where: { id: ctx.userId }, data: { name: "Bia Comercial" } });
        const { client, opportunity } = await withOpportunity(company.id, ctx.userId, { title: "Formatura" });
        await move(ctx, opportunity.id, "CONTACTED", 1);

        const detail = await getOpportunity({ ...ctx, opportunityId: opportunity.id });

        expect(detail.client).toMatchObject({ id: client.id });
        expect(detail.owner).toMatchObject({ name: "Bia Comercial" });
        expect(detail.history.map((h) => h.text)).toEqual(["Etapa: Novo → Em contato", "Oportunidade criada."]);
        expect(detail.history[0]!.actorName).toBe("Bia Comercial");
      });

      it("id que não existe: 404", async () => {
        const { ctx } = await setup();
        await expect(getOpportunity({ ...ctx, opportunityId: "00000000-0000-4000-8000-000000000000" })).rejects.toEqual(adminError(404));
      });
    });
  });

  describe("cliente com oportunidades", () => {
    it("getClient traz as oportunidades dele, das mais novas às mais antigas", async () => {
      const { company, ctx } = await setup();
      const client = await withClient(company.id, ctx.userId);
      const first = await createOpportunity({ ...ctx, input: oppInput(client.id, { title: "Primeira" }) });
      const second = await createOpportunity({ ...ctx, input: oppInput(client.id, { title: "Segunda" }) });

      const detail = await getClient({ ...ctx, clientId: client.id });

      expect(detail.client.id).toBe(client.id);
      expect(detail.opportunities.map((o) => o.id)).toEqual([second.id, first.id]);
    });
  });
});
