/**
 * Orçamento interno (integração — Postgres real, ver cabeçalho de sync-push.integration.test.ts).
 *
 * O que importa: só quem tem permissão para o orçamento o vê e o edita (e nunca o de outra
 * empresa); o custo e a margem saem SEMPRE da soma dos itens, em centavos; a margem usa a receita
 * mais firme que existe (proposta aceita > enviada > rascunho > valor estimado); duas pessoas
 * salvando ao mesmo tempo nunca se sobrescrevem; e nada muda depois que a oportunidade é perdida
 * ou vira evento.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createMembership,
  createTestCompany,
  createTestPrismaClient,
  createTestUser,
  truncateAll,
} from "../helpers/factories";
import { createClient } from "@/server/crm/client.service";
import { getBudget, getBudgetSummary, saveBudget } from "@/server/crm/budget.service";
import { convertToEvent, createOpportunity, getOpportunity, moveStage } from "@/server/crm/opportunity.service";
import { changeProposalStatus, createProposal } from "@/server/crm/proposal.service";

const prisma = createTestPrismaClient();

type CompanyRole = "OWNER" | "ADMIN" | "PRODUCER" | "STAFF" | "FREELANCER" | "VIEWER";
type Ctx = { userId: string; companyId: string };

const adminError = (status: number) => expect.objectContaining({ name: "AdminActionError", status });

const NOW = new Date("2027-01-05T15:00:00.000Z");

const clientInput = () =>
  ({ name: `Cliente ${Math.random().toString(36).slice(2, 8)}`, kind: "COMPANY", document: null, email: null, phone: null, notes: null }) as never;

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

const eventInput = () => ({
  name: "Festival de Verão 2027",
  description: null,
  location: null,
  startDate: "2027-01-10T12:00:00.000Z",
  endDate: "2027-01-12T12:00:00.000Z",
  status: "PLANNED" as const,
});

const item = (overrides: Record<string, unknown> = {}) => ({
  category: "AV",
  description: "Sonorização",
  quantity: 2,
  unitCostCents: 300_000,
  supplier: null,
  ...overrides,
});

/** 2 × R$ 3.000,00 (som) + 10 × R$ 200,00 (equipe) = R$ 8.000,00 de custo. */
const budgetInput = (overrides: Record<string, unknown> = {}) =>
  ({
    items: [item(), item({ category: "STAFF", description: "Técnicos de palco", quantity: 10, unitCostCents: 20_000, supplier: "Equipe Alfa" })],
    notes: null,
    baseVersion: 0,
    ...overrides,
  }) as never;

describe("orçamento interno (integração — Postgres real)", () => {
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
    return { company, owner, ctx: { userId: owner.id, companyId: company.id } as Ctx };
  }

  async function withOpportunity(ctx: Ctx, overrides: Record<string, unknown> = {}) {
    const client = await createClient({ ...ctx, input: clientInput() });
    return createOpportunity({ ...ctx, input: oppInput(client.id, overrides) });
  }

  const save = (ctx: Ctx, opportunityId: string, overrides: Record<string, unknown> = {}) =>
    saveBudget({ ...ctx, opportunityId, input: budgetInput(overrides) });

  /** Cria e envia (ou aceita) uma proposta de R$ 10.500,00: 2 × R$ 5.500,00 − R$ 500,00 de desconto. */
  async function proposal(ctx: Ctx, opportunityId: string, finalAction: "SEND" | "ACCEPT" | null = "SEND") {
    const draft = await createProposal({
      ...ctx,
      opportunityId,
      input: {
        items: [{ description: "Produção do festival", quantity: 2, unitPriceCents: 550_000 }],
        discountCents: 50_000,
        validUntil: "2027-01-31",
        notes: null,
        copiedFromProposalId: null,
      } as never,
    });
    if (finalAction === null) return draft;
    const sent = await changeProposalStatus({ ...ctx, proposalId: draft.id, input: { action: "SEND", baseVersion: draft.version, note: null } as never, now: NOW });
    if (finalAction === "SEND") return sent.proposal!;
    const accepted = await changeProposalStatus({ ...ctx, proposalId: draft.id, input: { action: "ACCEPT", baseVersion: sent.proposal!.version, note: null } as never, now: NOW });
    return accepted.proposal!;
  }

  describe("quem acessa", () => {
    it("titular e administração veem e montam o orçamento", async () => {
      const { company, ctx } = await setup();
      for (const role of ["OWNER", "ADMIN"] as const) {
        const user = await person(company.id, role);
        const opp = await withOpportunity(ctx);
        await expect(save({ userId: user.id, companyId: company.id }, opp.id), role).resolves.toMatchObject({ version: 1 });
        await expect(getBudget({ userId: user.id, companyId: company.id, opportunityId: opp.id }), role).resolves.toMatchObject({ budget: { version: 1 } });
      }
    });

    it("produção, equipe, freelancer e visualização NÃO acessam o orçamento (403) — em nenhuma função", async () => {
      const { company, ctx } = await setup();
      const opp = await withOpportunity(ctx);
      await save(ctx, opp.id);

      for (const role of ["PRODUCER", "STAFF", "FREELANCER", "VIEWER"] as const) {
        const user = await person(company.id, role);
        const c = { userId: user.id, companyId: company.id };
        const calls: Array<[string, () => Promise<unknown>]> = [
          ["getBudget", () => getBudget({ ...c, opportunityId: opp.id })],
          ["getBudgetSummary", () => getBudgetSummary({ ...c, opportunityId: opp.id })],
          ["saveBudget", () => save(c, opp.id, { baseVersion: 1 })],
        ];
        for (const [name, call] of calls) {
          await expect(call(), `${role} → ${name}`).rejects.toEqual(adminError(403));
        }
      }
      expect((await prisma.budget.findFirstOrThrow()).version).toBe(1);
    });

    it("vínculo encerrado: 403 (o papel é lido do banco a cada chamada)", async () => {
      const { company, ctx } = await setup();
      const opp = await withOpportunity(ctx);
      const user = await person(company.id, "ADMIN");
      await expect(save({ userId: user.id, companyId: company.id }, opp.id)).resolves.toMatchObject({ version: 1 });
      await prisma.membership.updateMany({ where: { userId: user.id }, data: { status: "REVOKED" } });

      await expect(save({ userId: user.id, companyId: company.id }, opp.id, { baseVersion: 1 })).rejects.toEqual(adminError(403));
    });

    it("quem perde o papel de administração perde o acesso na chamada seguinte (rebaixada para produção: 403)", async () => {
      const { company, ctx } = await setup();
      const opp = await withOpportunity(ctx);
      const user = await person(company.id, "ADMIN");
      const c = { userId: user.id, companyId: company.id };
      await expect(getBudgetSummary({ ...c, opportunityId: opp.id })).resolves.toMatchObject({ budget: null });

      await prisma.membership.updateMany({ where: { userId: user.id }, data: { role: "PRODUCER" } });

      await expect(getBudgetSummary({ ...c, opportunityId: opp.id })).rejects.toEqual(adminError(403));
    });

    it("a PRODUÇÃO cuida do comercial (vê a oportunidade e o preço) mas nada do custo: nem a leitura, nem o rastro no histórico", async () => {
      const { company, ctx } = await setup();
      const opp = await withOpportunity(ctx, { expectedValueCents: 1_200_000 });
      await save(ctx, opp.id);
      await save(ctx, opp.id, { baseVersion: 1, items: [item({ quantity: 1, unitCostCents: 500_000 })], notes: "Cortamos a equipe" });
      const producer = await person(company.id, "PRODUCER");
      const admin = await person(company.id, "ADMIN");

      // A produção lê a oportunidade normalmente (é do comercial)...
      const asProducer = await getOpportunity({ userId: producer.id, companyId: company.id, opportunityId: opp.id });
      expect(asProducer.opportunity.id).toBe(opp.id);
      // ...mas o histórico dela NÃO traz nenhuma linha do orçamento (elas dizem o custo).
      const producerLines = asProducer.history.map((h) => h.text);
      expect(producerLines).toEqual(["Oportunidade criada."]);
      expect(producerLines.join(" ")).not.toMatch(/rçamento|custo|R\$/);

      // A administração vê o mesmo histórico COM o orçamento.
      const asAdmin = await getOpportunity({ userId: admin.id, companyId: company.id, opportunityId: opp.id });
      expect(asAdmin.history.map((h) => h.text)).toEqual([
        "Orçamento editado: itens (custo de R$ 8.000,00 para R$ 5.000,00), observações.",
        "Orçamento criado (custo previsto de R$ 8.000,00).",
        "Oportunidade criada.",
      ]);
    });

    it("quem é de OUTRA empresa não enxerga nem edita o orçamento desta (404)", async () => {
      const { ctx } = await setup();
      const opp = await withOpportunity(ctx);
      await save(ctx, opp.id);
      const other = await createTestCompany(prisma);
      const outsider = await person(other.id, "OWNER");
      const theirs = { userId: outsider.id, companyId: other.id };

      await expect(getBudget({ ...theirs, opportunityId: opp.id })).rejects.toEqual(adminError(404));
      await expect(getBudgetSummary({ ...theirs, opportunityId: opp.id })).rejects.toEqual(adminError(404));
      await expect(save(theirs, opp.id, { baseVersion: 1, notes: "invadido" })).rejects.toEqual(adminError(404));
      expect((await prisma.budget.findFirstOrThrow()).notes).toBeNull();
    });
  });

  describe("salvar", () => {
    it("o custo sai da soma dos itens em centavos, com o subtotal de cada categoria, e nada de total é gravado", async () => {
      const { ctx } = await setup();
      const opp = await withOpportunity(ctx);

      const saved = await save(ctx, opp.id, { notes: "Premissa: montagem em 2 dias" });
      const view = await getBudget({ ...ctx, opportunityId: opp.id });

      expect(saved).toMatchObject({ version: 1, notes: "Premissa: montagem em 2 dias", createdBy: ctx.userId });
      expect(saved.items.map((i) => [i.position, i.category, i.description, i.quantity, i.unitCostCents, i.supplier])).toEqual([
        [0, "AV", "Sonorização", 2, 300_000, null],
        [1, "STAFF", "Técnicos de palco", 10, 20_000, "Equipe Alfa"],
      ]);
      expect(view.totals.totalCents).toBe(800_000);
      expect(view.totals.lineTotals).toEqual([600_000, 200_000]);
      expect(view.totals.byCategory).toEqual([
        { category: "AV", subtotalCents: 600_000, itemCount: 1 },
        { category: "STAFF", subtotalCents: 200_000, itemCount: 1 },
      ]);
      // Sem receita de referência não há margem — e a tela diz isso, não inventa zero.
      expect(view.revenue).toBeNull();
      expect(view.margin).toBeNull();
    });

    it("valores acima do teto: 422, e nada é criado", async () => {
      const { ctx } = await setup();
      const opp = await withOpportunity(ctx);

      await expect(save(ctx, opp.id, { items: [item({ quantity: 100_000, unitCostCents: 1_000_000 })] })).rejects.toEqual(adminError(422));
      const big = item({ quantity: 1, unitCostCents: 1_500_000_000 });
      await expect(save(ctx, opp.id, { items: [big, big] })).rejects.toEqual(adminError(422));
      expect(await prisma.budget.count()).toBe(0);
    });

    it("editar troca a lista INTEIRA, sobe a versão e grava a auditoria com antes e depois", async () => {
      const { ctx } = await setup();
      const opp = await withOpportunity(ctx);
      await save(ctx, opp.id);

      const updated = await save(ctx, opp.id, {
        items: [item({ category: "VENUE", description: "Locação do espaço", quantity: 1, unitCostCents: 1_500_000 })],
        notes: "Fechado com o espaço",
        baseVersion: 1,
      });

      expect(updated).toMatchObject({ version: 2, notes: "Fechado com o espaço", updatedBy: ctx.userId });
      expect(updated.items.map((i) => i.description)).toEqual(["Locação do espaço"]);
      expect(await prisma.budgetItem.count()).toBe(1);
      const audit = await prisma.auditLog.findMany({ where: { entityType: "Budget" }, orderBy: { createdAt: "asc" } });
      expect(audit.map((a) => a.action)).toEqual(["BUDGET_CREATED", "BUDGET_UPDATED"]);
      expect(audit[1]!.beforeJson).toMatchObject({ items: [{ description: "Sonorização" }, { description: "Técnicos de palco" }] });
      expect(audit[1]!.afterJson).toMatchObject({ notes: "Fechado com o espaço", items: [{ description: "Locação do espaço" }] });
      expect(audit[1]!.metadata).toMatchObject({ opportunityId: opp.id });
    });

    it("versão velha: 409 e o que a outra pessoa gravou fica", async () => {
      const { ctx } = await setup();
      const opp = await withOpportunity(ctx);
      await save(ctx, opp.id);
      await save(ctx, opp.id, { baseVersion: 1, notes: "primeira" });

      await expect(save(ctx, opp.id, { baseVersion: 1, notes: "segunda" })).rejects.toMatchObject({
        status: 409,
        message: expect.stringContaining("alterado por outra pessoa"),
      });
      expect((await prisma.budget.findFirstOrThrow()).notes).toBe("primeira");
    });

    it("quem abriu a tela VAZIA e chega depois de outra pessoa criar o orçamento recebe 409 (e não o sobrescreve)", async () => {
      const { ctx } = await setup();
      const opp = await withOpportunity(ctx);
      await save(ctx, opp.id, { notes: "da primeira pessoa" });

      await expect(save(ctx, opp.id, { baseVersion: 0, notes: "da segunda" })).rejects.toEqual(adminError(409));
      expect((await prisma.budget.findFirstOrThrow()).notes).toBe("da primeira pessoa");
    });

    it("dizer que existe uma versão quando ainda não há orçamento também é recusado", async () => {
      const { ctx } = await setup();
      const opp = await withOpportunity(ctx);

      await expect(save(ctx, opp.id, { baseVersion: 3 })).rejects.toEqual(adminError(409));
      expect(await prisma.budget.count()).toBe(0);
    });

    it("cada oportunidade tem o seu orçamento (o de uma não aparece na outra)", async () => {
      const { ctx } = await setup();
      const first = await withOpportunity(ctx);
      const second = await withOpportunity(ctx);
      await save(ctx, first.id);

      expect((await getBudget({ ...ctx, opportunityId: second.id })).budget).toBeNull();
      await expect(save(ctx, second.id)).resolves.toMatchObject({ version: 1 });
      expect(await prisma.budget.count()).toBe(2);
    });
  });

  describe("quando dá para editar", () => {
    it("oportunidade em andamento ou GANHA (sem evento): edita; perdida: 409 até reabrir", async () => {
      const { ctx } = await setup();
      const opp = await withOpportunity(ctx);
      await save(ctx, opp.id);
      const won = await moveStage({ ...ctx, opportunityId: opp.id, input: { stage: "WON", lostReason: null, baseVersion: 1 } as never });
      await expect(save(ctx, opp.id, { baseVersion: 1, notes: "ajuste ao fechar" })).resolves.toMatchObject({ version: 2 });

      const lost = await withOpportunity(ctx);
      await save(ctx, lost.id);
      await moveStage({ ...ctx, opportunityId: lost.id, input: { stage: "LOST", lostReason: "Sem orçamento", baseVersion: 1 } as never });
      await expect(save(ctx, lost.id, { baseVersion: 1 })).rejects.toMatchObject({ status: 409, message: expect.stringContaining("perdida") });
      // Ler continua possível, e o motivo do bloqueio vem junto para a tela.
      const view = await getBudget({ ...ctx, opportunityId: lost.id });
      expect(view.blockedReason).toMatch(/perdida/);
      expect(won.stage).toBe("WON");
    });

    it("depois de virar evento o orçamento fica só para consulta", async () => {
      const { ctx } = await setup();
      const opp = await withOpportunity(ctx);
      await save(ctx, opp.id);
      await convertToEvent({ ...ctx, opportunityId: opp.id, input: { event: eventInput(), baseVersion: 1 } as never });

      await expect(save(ctx, opp.id, { baseVersion: 1 })).rejects.toMatchObject({ status: 409, message: expect.stringContaining("virou um evento") });
      const view = await getBudget({ ...ctx, opportunityId: opp.id });
      expect(view.totals.totalCents).toBe(800_000);
      expect(view.blockedReason).toMatch(/virou um evento/);
    });

    it("no primeiro salvamento também vale (não cria orçamento de oportunidade perdida)", async () => {
      const { ctx } = await setup();
      const opp = await withOpportunity(ctx);
      await moveStage({ ...ctx, opportunityId: opp.id, input: { stage: "LOST", lostReason: "Sem orçamento", baseVersion: 1 } as never });

      await expect(save(ctx, opp.id)).rejects.toEqual(adminError(409));
      expect(await prisma.budget.count()).toBe(0);
    });
  });

  describe("receita de referência e margem", () => {
    const view = (ctx: Ctx, id: string) => getBudgetSummary({ ...ctx, opportunityId: id });

    it("sem proposta usa o valor ESTIMADO da oportunidade — dizendo que é uma estimativa", async () => {
      const { ctx } = await setup();
      const opp = await withOpportunity(ctx, { expectedValueCents: 1_200_000 });
      await save(ctx, opp.id);

      const { revenue, margin } = await view(ctx, opp.id);

      expect(revenue).toMatchObject({ kind: "ESTIMATE", cents: 1_200_000, label: "Valor estimado da oportunidade" });
      expect(margin).toEqual({ marginCents: 400_000, marginBps: 3333 });
    });

    it("a proposta mais firme vence: rascunho < enviada < aceita (e a margem acompanha)", async () => {
      const { ctx } = await setup();
      const opp = await withOpportunity(ctx, { expectedValueCents: 1_200_000 });
      await save(ctx, opp.id);

      const draft = await proposal(ctx, opp.id, null);
      expect((await view(ctx, opp.id)).revenue).toMatchObject({ kind: "DRAFT", cents: 1_050_000, label: "Proposta v1 (rascunho)" });

      await changeProposalStatus({ ...ctx, proposalId: draft.id, input: { action: "SEND", baseVersion: draft.version, note: null } as never, now: NOW });
      const sent = await view(ctx, opp.id);
      expect(sent.revenue).toMatchObject({ kind: "SENT", cents: 1_050_000, label: "Proposta v1 (enviada)" });
      expect(sent.margin).toEqual({ marginCents: 250_000, marginBps: 2381 });

      const current = await prisma.proposal.findUniqueOrThrow({ where: { id: draft.id } });
      await changeProposalStatus({ ...ctx, proposalId: draft.id, input: { action: "ACCEPT", baseVersion: current.version, note: null } as never, now: NOW });
      expect((await view(ctx, opp.id)).revenue).toMatchObject({ kind: "ACCEPTED", label: "Proposta v1 (aceita)" });
    });

    it("proposta recusada ou substituída NÃO é receita: volta para a estimativa", async () => {
      const { ctx } = await setup();
      const opp = await withOpportunity(ctx, { expectedValueCents: 1_200_000 });
      await save(ctx, opp.id);
      const sent = await proposal(ctx, opp.id, "SEND");

      await changeProposalStatus({ ...ctx, proposalId: sent.id, input: { action: "REJECT", baseVersion: sent.version, note: "Achou caro" } as never, now: NOW });

      expect((await view(ctx, opp.id)).revenue).toMatchObject({ kind: "ESTIMATE", cents: 1_200_000 });
    });

    it("margem NEGATIVA (prejuízo) é calculada, não escondida", async () => {
      const { ctx } = await setup();
      const opp = await withOpportunity(ctx, { expectedValueCents: 500_000 });
      await save(ctx, opp.id);

      expect((await view(ctx, opp.id)).margin).toEqual({ marginCents: -300_000, marginBps: -6000 });
    });

    it("receita zero: a margem em R$ existe, o percentual não (não há divisão por zero)", async () => {
      const { ctx } = await setup();
      const opp = await withOpportunity(ctx, { expectedValueCents: 0 });
      await save(ctx, opp.id);

      expect((await view(ctx, opp.id)).margin).toEqual({ marginCents: -800_000, marginBps: null });
    });

    it("sem orçamento não há margem, mesmo com receita", async () => {
      const { ctx } = await setup();
      const opp = await withOpportunity(ctx, { expectedValueCents: 1_200_000 });

      const summary = await view(ctx, opp.id);

      expect(summary.budget).toBeNull();
      expect(summary.revenue).toMatchObject({ kind: "ESTIMATE" });
      expect(summary.margin).toBeNull();
    });
  });

  describe("histórico", () => {
    it("o histórico da oportunidade traz o do orçamento, em palavras, com o custo antes e depois", async () => {
      const { ctx } = await setup();
      const opp = await withOpportunity(ctx);
      await save(ctx, opp.id);
      await save(ctx, opp.id, { baseVersion: 1, items: [item({ quantity: 1, unitCostCents: 500_000 })], notes: "Cortamos a equipe" });

      const { history } = await getOpportunity({ ...ctx, opportunityId: opp.id });

      expect(history.map((h) => h.text)).toEqual([
        "Orçamento editado: itens (custo de R$ 8.000,00 para R$ 5.000,00), observações.",
        "Orçamento criado (custo previsto de R$ 8.000,00).",
        "Oportunidade criada.",
      ]);
      // E o histórico do próprio orçamento traz só o que é dele.
      const own = await getBudget({ ...ctx, opportunityId: opp.id });
      expect(own.history.map((h) => h.text)).toHaveLength(2);
    });
  });

  describe("concorrência (cada uma repetida em várias rodadas)", () => {
    const ROUNDS = 8;

    it("dois 'primeiros salvamentos' ao mesmo tempo: um orçamento só, e um dos dois é avisado", async () => {
      for (let round = 0; round < ROUNDS; round++) {
        await truncateAll(prisma);
        const { ctx } = await setup();
        const opp = await withOpportunity(ctx);

        const results = await Promise.allSettled([save(ctx, opp.id, { notes: "A" }), save(ctx, opp.id, { notes: "B" }), save(ctx, opp.id, { notes: "C" })]);

        expect(results.filter((r) => r.status === "fulfilled"), `rodada ${round}`).toHaveLength(1);
        for (const r of results.filter((r) => r.status === "rejected")) expect(r.reason).toEqual(adminError(409));
        expect(await prisma.budget.count(), `rodada ${round}`).toBe(1);
        expect(await prisma.budgetItem.count(), `rodada ${round}`).toBe(2);
      }
    });

    it("duas edições da mesma versão ao mesmo tempo: só uma vale, e os itens ficam íntegros", async () => {
      for (let round = 0; round < ROUNDS; round++) {
        await truncateAll(prisma);
        const { ctx } = await setup();
        const opp = await withOpportunity(ctx);
        await save(ctx, opp.id);

        const results = await Promise.allSettled([
          save(ctx, opp.id, { baseVersion: 1, notes: "A", items: [item({ description: "Item da A" })] }),
          save(ctx, opp.id, { baseVersion: 1, notes: "B", items: [item({ description: "Item da B" }), item({ description: "Outro da B", category: "FOOD" })] }),
        ]);

        expect(results.filter((r) => r.status === "fulfilled"), `rodada ${round}`).toHaveLength(1);
        const stored = await prisma.budget.findFirstOrThrow({ include: { items: { orderBy: { position: "asc" } } } });
        expect(stored.version, `rodada ${round}`).toBe(2);
        // O que ficou é inteiro de UMA das duas edições (nunca uma mistura).
        const expected = stored.notes === "A" ? ["Item da A"] : ["Item da B", "Outro da B"];
        expect(stored.items.map((i) => i.description), `rodada ${round}`).toEqual(expected);
      }
    });

    it("salvar × transformar em evento: ou o orçamento entra antes do evento, ou é recusado — nunca muda depois", async () => {
      for (let round = 0; round < ROUNDS; round++) {
        await truncateAll(prisma);
        const { ctx } = await setup();
        const opp = await withOpportunity(ctx);
        await save(ctx, opp.id);

        const [saved] = await Promise.allSettled([
          save(ctx, opp.id, { baseVersion: 1, notes: "tarde demais?" }),
          convertToEvent({ ...ctx, opportunityId: opp.id, input: { event: eventInput(), baseVersion: 1 } as never }),
        ]);

        const stored = await prisma.budget.findFirstOrThrow();
        const converted = (await prisma.opportunity.findUniqueOrThrow({ where: { id: opp.id } })).eventId !== null;
        // Coerente: o que ficou gravado é o que a resposta disse, e depois do evento nada entra.
        expect(stored.notes === "tarde demais?", `rodada ${round}`).toBe(saved.status === "fulfilled");
        if (converted && saved.status === "rejected") expect(saved.reason).toEqual(adminError(409));
      }
    });
  });
});
