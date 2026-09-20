/**
 * Propostas comerciais (integração — Postgres real, ver cabeçalho de sync-push.integration.test.ts).
 *
 * O que importa: só o comercial da empresa mexe (e nunca em dado de outra empresa); os totais são
 * SEMPRE calculados pelo servidor, em centavos; a proposta enviada nunca muda (só ganha uma nova
 * versão); por oportunidade há no máximo um rascunho e uma enviada, mesmo com cliques simultâneos;
 * aceitar leva a oportunidade a "Ganho"; e nada disso se mexe depois que a oportunidade vira evento.
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
import { convertToEvent, createOpportunity, getOpportunity, moveStage } from "@/server/crm/opportunity.service";
import {
  changeProposalStatus,
  createProposal,
  getProposal,
  listOpportunityProposals,
  listProposals,
  prepareNewProposal,
  updateProposal,
} from "@/server/crm/proposal.service";

const prisma = createTestPrismaClient();

type CompanyRole = "OWNER" | "ADMIN" | "PRODUCER" | "STAFF" | "FREELANCER" | "VIEWER";
type Ctx = { userId: string; companyId: string };
type Action = "SEND" | "ACCEPT" | "REJECT" | "DISCARD";

const adminError = (status: number) => expect.objectContaining({ name: "AdminActionError", status });

/** 05/01/2027 em Brasília: o "hoje" fixo dos testes de validade. */
const NOW = new Date("2027-01-05T15:00:00.000Z");
const STILL_VALID = "2027-01-31";
const EXPIRED = "2027-01-04";

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

const eventInput = () => ({
  name: "Festival de Verão 2027",
  description: null,
  location: null,
  startDate: "2027-01-10T12:00:00.000Z",
  endDate: "2027-01-12T12:00:00.000Z",
  status: "PLANNED" as const,
});

/** 2 × R$ 5.000,00 + 1 × R$ 1.500,00 = R$ 11.500,00 de subtotal; menos R$ 500,00 = R$ 11.000,00. */
const proposalInput = (overrides: Record<string, unknown> = {}) =>
  ({
    items: [
      { description: "Som e iluminação", quantity: 2, unitPriceCents: 500_000 },
      { description: "Equipe de palco", quantity: 1, unitPriceCents: 150_000 },
    ],
    discountCents: 50_000,
    validUntil: STILL_VALID,
    notes: null,
    copiedFromProposalId: null,
    ...overrides,
  }) as never;

describe("propostas comerciais (integração — Postgres real)", () => {
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
    const client = await createClient({ ...ctx, input: clientInput({ name: `Cliente ${Math.random().toString(36).slice(2, 8)}` }) });
    const opportunity = await createOpportunity({ ...ctx, input: oppInput(client.id, overrides) });
    return { client, opportunity };
  }

  const make = (ctx: Ctx, opportunityId: string, overrides: Record<string, unknown> = {}) =>
    createProposal({ ...ctx, opportunityId, input: proposalInput(overrides) });

  const act = (ctx: Ctx, proposalId: string, action: Action, baseVersion: number, note: string | null = null) =>
    changeProposalStatus({ ...ctx, proposalId, input: { action, baseVersion, note } as never, now: NOW });

  /** Cria e ENVIA uma proposta; devolve a enviada. */
  async function sendOne(ctx: Ctx, opportunityId: string, overrides: Record<string, unknown> = {}) {
    const draft = await make(ctx, opportunityId, overrides);
    const result = await act(ctx, draft.id, "SEND", draft.version);
    return result.proposal!;
  }

  const stageOf = async (id: string) => (await prisma.opportunity.findUniqueOrThrow({ where: { id } })).stage;
  const statuses = async (opportunityId: string) =>
    (await prisma.proposal.findMany({ where: { opportunityId }, orderBy: { number: "asc" } })).map((p) => `${p.number}:${p.status}`);

  describe("quem acessa", () => {
    it("equipe, freelancer e visualização NÃO acessam nada das propostas (403) — em nenhuma função", async () => {
      const { company, ctx } = await setup();
      const { opportunity } = await withOpportunity(ctx);
      const proposal = await make(ctx, opportunity.id);

      for (const role of ["STAFF", "FREELANCER", "VIEWER"] as const) {
        const user = await person(company.id, role);
        const c = { userId: user.id, companyId: company.id };
        const calls: Array<[string, () => Promise<unknown>]> = [
          ["listProposals", () => listProposals(c)],
          ["listOpportunityProposals", () => listOpportunityProposals({ ...c, opportunityId: opportunity.id })],
          ["getProposal", () => getProposal({ ...c, proposalId: proposal.id })],
          ["prepareNewProposal", () => prepareNewProposal({ ...c, opportunityId: opportunity.id })],
          ["createProposal", () => make(c, opportunity.id)],
          ["updateProposal", () => updateProposal({ ...c, proposalId: proposal.id, input: { ...(proposalInput() as object), baseVersion: 1 } as never })],
          ["changeProposalStatus", () => act(c, proposal.id, "SEND", 1)],
        ];
        for (const [name, call] of calls) {
          await expect(call(), `${role} → ${name}`).rejects.toEqual(adminError(403));
        }
      }
      // Nada mudou.
      expect(await statuses(opportunity.id)).toEqual(["1:DRAFT"]);
    });

    it("titular, administração e produção cuidam das propostas", async () => {
      const { company, ctx } = await setup();
      for (const role of ["OWNER", "ADMIN", "PRODUCER"] as const) {
        const user = await person(company.id, role);
        const { opportunity } = await withOpportunity(ctx);
        await expect(make({ userId: user.id, companyId: company.id }, opportunity.id), role).resolves.toMatchObject({ number: 1 });
      }
    });

    it("vínculo encerrado: 403 (o papel é lido do banco a cada chamada)", async () => {
      const { company, ctx } = await setup();
      const { opportunity } = await withOpportunity(ctx);
      const user = await person(company.id, "PRODUCER");
      await prisma.membership.updateMany({ where: { userId: user.id }, data: { status: "REVOKED" } });
      await expect(make({ userId: user.id, companyId: company.id }, opportunity.id)).rejects.toEqual(adminError(403));
    });

    it("quem é de OUTRA empresa não enxerga, edita nem move nada desta (404)", async () => {
      const { ctx } = await setup();
      const { opportunity } = await withOpportunity(ctx);
      const proposal = await make(ctx, opportunity.id);
      const other = await createTestCompany(prisma);
      const outsider = await person(other.id, "OWNER");
      const theirs = { userId: outsider.id, companyId: other.id };

      await expect(getProposal({ ...theirs, proposalId: proposal.id })).rejects.toEqual(adminError(404));
      await expect(make(theirs, opportunity.id)).rejects.toEqual(adminError(404));
      await expect(listOpportunityProposals({ ...theirs, opportunityId: opportunity.id })).rejects.toEqual(adminError(404));
      await expect(prepareNewProposal({ ...theirs, opportunityId: opportunity.id })).rejects.toEqual(adminError(404));
      await expect(
        updateProposal({ ...theirs, proposalId: proposal.id, input: { ...(proposalInput() as object), baseVersion: 1 } as never })
      ).rejects.toEqual(adminError(404));
      await expect(act(theirs, proposal.id, "SEND", 1)).rejects.toEqual(adminError(404));
      await expect(act(theirs, proposal.id, "DISCARD", 1)).rejects.toEqual(adminError(404));
      expect((await listProposals(theirs)).rows).toEqual([]);
      expect(await statuses(opportunity.id)).toEqual(["1:DRAFT"]);
    });
  });

  describe("criar", () => {
    it("o SERVIDOR calcula os totais em centavos: subtotal, desconto e total", async () => {
      const { ctx } = await setup();
      const { opportunity } = await withOpportunity(ctx);

      const proposal = await make(ctx, opportunity.id);

      expect(proposal).toMatchObject({ number: 1, status: "DRAFT", version: 1, subtotalCents: 1_150_000, discountCents: 50_000, totalCents: 1_100_000 });
      expect(proposal.items.map((i) => [i.position, i.description, i.quantity, i.unitPriceCents])).toEqual([
        [0, "Som e iluminação", 2, 500_000],
        [1, "Equipe de palco", 1, 150_000],
      ]);
      expect(proposal.validUntil?.toISOString().slice(0, 10)).toBe(STILL_VALID);
    });

    it("valores acima do teto ou desconto maior que o subtotal: 422, e nada é criado", async () => {
      const { ctx } = await setup();
      const { opportunity } = await withOpportunity(ctx);
      const tooBig = { description: "Item", quantity: 100_000, unitPriceCents: 1_000_000 };

      await expect(make(ctx, opportunity.id, { items: [tooBig] })).rejects.toEqual(adminError(422));
      await expect(make(ctx, opportunity.id, { discountCents: 9_999_999 })).rejects.toEqual(adminError(422));
      expect(await prisma.proposal.count()).toBe(0);
    });

    it("só UM rascunho por oportunidade: o segundo recebe 409 dizendo qual é o rascunho", async () => {
      const { ctx } = await setup();
      const { opportunity } = await withOpportunity(ctx);
      await make(ctx, opportunity.id);

      await expect(make(ctx, opportunity.id)).rejects.toMatchObject({ status: 409, message: expect.stringContaining("rascunho (v1)") });
      expect(await statuses(opportunity.id)).toEqual(["1:DRAFT"]);
    });

    it("a numeração segue por oportunidade (v1, v2, v3…) e cada oportunidade começa em v1", async () => {
      const { ctx } = await setup();
      const first = await withOpportunity(ctx);
      const second = await withOpportunity(ctx);

      await sendOne(ctx, first.opportunity.id);
      const v2 = await make(ctx, first.opportunity.id);
      const other = await make(ctx, second.opportunity.id);

      expect(v2.number).toBe(2);
      expect(other.number).toBe(1);
    });

    it("descartar o rascunho libera o número: a próxima nasce com o mesmo número", async () => {
      const { ctx } = await setup();
      const { opportunity } = await withOpportunity(ctx);
      const draft = await make(ctx, opportunity.id);
      await act(ctx, draft.id, "DISCARD", draft.version);

      await expect(make(ctx, opportunity.id)).resolves.toMatchObject({ number: 1 });
    });

    it("registra de qual versão partiu — e só aceita uma versão DESTA oportunidade", async () => {
      const { ctx } = await setup();
      const { opportunity } = await withOpportunity(ctx);
      const other = await withOpportunity(ctx);
      const v1 = await sendOne(ctx, opportunity.id);
      const foreign = await make(ctx, other.opportunity.id);

      await expect(make(ctx, opportunity.id, { copiedFromProposalId: foreign.id })).rejects.toEqual(adminError(422));
      const v2 = await make(ctx, opportunity.id, { copiedFromProposalId: v1.id });

      const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityType: "Proposal", entityId: v2.id, action: "PROPOSAL_CREATED" } });
      expect(audit.metadata).toMatchObject({ opportunityId: opportunity.id, copiedFromProposalId: v1.id, copiedFromNumber: 1 });
    });

    it("oportunidade ganha, perdida ou que virou evento: não cria proposta (409)", async () => {
      const { ctx } = await setup();
      const won = await withOpportunity(ctx);
      const lost = await withOpportunity(ctx);
      const converted = await withOpportunity(ctx);
      await moveStage({ ...ctx, opportunityId: won.opportunity.id, input: { stage: "WON", lostReason: null, baseVersion: 1 } as never });
      await moveStage({ ...ctx, opportunityId: lost.opportunity.id, input: { stage: "LOST", lostReason: "Sem orçamento", baseVersion: 1 } as never });
      await convertToEvent({ ...ctx, opportunityId: converted.opportunity.id, input: { event: eventInput(), baseVersion: 1 } as never });

      for (const { opportunity } of [won, lost, converted]) {
        await expect(make(ctx, opportunity.id)).rejects.toEqual(adminError(409));
      }
      expect(await prisma.proposal.count()).toBe(0);
    });

    it("grava a auditoria da criação, com os itens", async () => {
      const { ctx } = await setup();
      const { opportunity } = await withOpportunity(ctx);
      const proposal = await make(ctx, opportunity.id);

      const audit = await prisma.auditLog.findMany({ where: { entityType: "Proposal", entityId: proposal.id } });
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ action: "PROPOSAL_CREATED", userId: ctx.userId, companyId: ctx.companyId });
      expect(audit[0]!.afterJson).toMatchObject({ number: 1, status: "DRAFT", totalCents: 1_100_000, items: [{ description: "Som e iluminação" }, { description: "Equipe de palco" }] });
    });
  });

  describe("editar o rascunho", () => {
    it("troca os itens por inteiro, recalcula os totais e sobe a versão", async () => {
      const { ctx } = await setup();
      const { opportunity } = await withOpportunity(ctx);
      const draft = await make(ctx, opportunity.id);

      const updated = await updateProposal({
        ...ctx,
        proposalId: draft.id,
        input: {
          items: [{ description: "Locação de palco", quantity: 3, unitPriceCents: 99_999 }],
          discountCents: 0,
          validUntil: "2027-02-15",
          notes: "Pagamento em 3x",
          baseVersion: 1,
        } as never,
      });

      expect(updated).toMatchObject({ version: 2, subtotalCents: 299_997, discountCents: 0, totalCents: 299_997, notes: "Pagamento em 3x" });
      expect(updated.items.map((i) => i.description)).toEqual(["Locação de palco"]);
      expect(updated.validUntil?.toISOString().slice(0, 10)).toBe("2027-02-15");
      expect(await prisma.proposalItem.count({ where: { proposalId: draft.id } })).toBe(1);

      const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityType: "Proposal", entityId: draft.id, action: "PROPOSAL_UPDATED" } });
      expect(audit.beforeJson).toMatchObject({ totalCents: 1_100_000 });
      expect(audit.afterJson).toMatchObject({ totalCents: 299_997 });
    });

    it("se outra pessoa editou antes (versão velha), 409 e o que a outra gravou fica", async () => {
      const { ctx } = await setup();
      const { opportunity } = await withOpportunity(ctx);
      const draft = await make(ctx, opportunity.id);
      const edit = (baseVersion: number, notes: string) =>
        updateProposal({ ...ctx, proposalId: draft.id, input: { ...(proposalInput() as object), notes, baseVersion } as never });

      await edit(1, "primeira");
      await expect(edit(1, "segunda")).rejects.toMatchObject({ status: 409, message: expect.stringContaining("alterada por outra pessoa") });

      expect((await prisma.proposal.findUniqueOrThrow({ where: { id: draft.id } })).notes).toBe("primeira");
    });

    it("proposta ENVIADA (ou qualquer uma que não é rascunho) não se edita — o caminho é uma nova versão", async () => {
      const { ctx } = await setup();
      const { opportunity } = await withOpportunity(ctx);
      const sent = await sendOne(ctx, opportunity.id);

      await expect(
        updateProposal({ ...ctx, proposalId: sent.id, input: { ...(proposalInput() as object), notes: "trocado", baseVersion: sent.version } as never })
      ).rejects.toMatchObject({ status: 409, message: expect.stringContaining("nova versão") });
      expect((await prisma.proposal.findUniqueOrThrow({ where: { id: sent.id } })).notes).toBeNull();
    });

    it("com a oportunidade perdida, o rascunho fica travado até reabrir", async () => {
      const { ctx } = await setup();
      const { opportunity } = await withOpportunity(ctx);
      const draft = await make(ctx, opportunity.id);
      await moveStage({ ...ctx, opportunityId: opportunity.id, input: { stage: "LOST", lostReason: "Sem orçamento", baseVersion: 1 } as never });

      await expect(
        updateProposal({ ...ctx, proposalId: draft.id, input: { ...(proposalInput() as object), baseVersion: draft.version } as never })
      ).rejects.toMatchObject({ status: 409, message: expect.stringContaining("perdida") });
    });
  });

  describe("enviar", () => {
    it("marca como enviada (quando e por quem), leva a oportunidade a 'Proposta enviada' e grava a auditoria", async () => {
      const { ctx } = await setup();
      const { opportunity } = await withOpportunity(ctx);
      const draft = await make(ctx, opportunity.id);

      const { proposal, opportunity: moved } = await act(ctx, draft.id, "SEND", draft.version);

      expect(proposal).toMatchObject({ status: "SENT", version: 2, sentBy: ctx.userId });
      expect(proposal!.sentAt).toEqual(NOW);
      expect(moved.stage).toBe("PROPOSAL_SENT");
      expect(await stageOf(opportunity.id)).toBe("PROPOSAL_SENT");
      const audit = await prisma.auditLog.findMany({ where: { entityId: { in: [draft.id, opportunity.id] } }, orderBy: { createdAt: "asc" } });
      expect(audit.map((a) => a.action)).toEqual(["OPPORTUNITY_CREATED", "PROPOSAL_CREATED", "PROPOSAL_SENT", "OPPORTUNITY_STAGE_CHANGED"]);
      // Na mesma transação o relógio do banco é um só: cada linha leva o seu instante, senão o histórico
      // (do mais novo ao mais antigo) poderia trocar a ordem do que aconteceu junto.
      const at = (action: string) => audit.find((a) => a.action === action)!.createdAt.getTime();
      expect(at("PROPOSAL_SENT")).toBeLessThan(at("OPPORTUNITY_STAGE_CHANGED"));
    });

    it("só anda a etapa PARA A FRENTE: quem está em negociação continua em negociação", async () => {
      const { ctx } = await setup();
      const { opportunity } = await withOpportunity(ctx);
      await moveStage({ ...ctx, opportunityId: opportunity.id, input: { stage: "NEGOTIATION", lostReason: null, baseVersion: 1 } as never });

      await sendOne(ctx, opportunity.id);

      expect(await stageOf(opportunity.id)).toBe("NEGOTIATION");
    });

    it("exige validade que ainda vale, itens com total maior que zero — e diz o que falta", async () => {
      const { ctx } = await setup();
      const { opportunity } = await withOpportunity(ctx);

      const noDate = await make(ctx, opportunity.id, { validUntil: null });
      await expect(act(ctx, noDate.id, "SEND", 1)).rejects.toMatchObject({ status: 409, message: expect.stringContaining("até quando a proposta vale") });
      await act(ctx, noDate.id, "DISCARD", 1);

      const expired = await make(ctx, opportunity.id, { validUntil: EXPIRED });
      await expect(act(ctx, expired.id, "SEND", 1)).rejects.toMatchObject({ status: 409, message: expect.stringContaining("04/01/2027") });
      await act(ctx, expired.id, "DISCARD", 1);

      const free = await make(ctx, opportunity.id, { items: [{ description: "Cortesia", quantity: 1, unitPriceCents: 0 }], discountCents: 0 });
      await expect(act(ctx, free.id, "SEND", 1)).rejects.toMatchObject({ status: 409, message: expect.stringContaining("maior que zero") });

      expect(await stageOf(opportunity.id)).toBe("NEW");
    });

    it("o último dia da validade ainda vale (vence só no dia seguinte)", async () => {
      const { ctx } = await setup();
      const { opportunity } = await withOpportunity(ctx);
      const draft = await make(ctx, opportunity.id, { validUntil: "2027-01-05" });

      await expect(act(ctx, draft.id, "SEND", 1)).resolves.toMatchObject({ proposal: { status: "SENT" } });
    });

    it("enviar de novo (ou com a versão velha) recebe 409 e nada muda", async () => {
      const { ctx } = await setup();
      const { opportunity } = await withOpportunity(ctx);
      const draft = await make(ctx, opportunity.id);
      await act(ctx, draft.id, "SEND", 1);

      await expect(act(ctx, draft.id, "SEND", 1)).rejects.toEqual(adminError(409));
      expect((await prisma.proposal.findUniqueOrThrow({ where: { id: draft.id } })).version).toBe(2);
    });

    it("enviar a v2 SUBSTITUI a v1: só uma enviada por oportunidade, e a v1 fica no histórico", async () => {
      const { ctx } = await setup();
      const { opportunity } = await withOpportunity(ctx);
      const v1 = await sendOne(ctx, opportunity.id);
      const v2 = await make(ctx, opportunity.id, { copiedFromProposalId: v1.id });
      // Enquanto a v2 é rascunho, a v1 continua valendo.
      expect(await statuses(opportunity.id)).toEqual(["1:SENT", "2:DRAFT"]);

      await act(ctx, v2.id, "SEND", v2.version);

      expect(await statuses(opportunity.id)).toEqual(["1:SUPERSEDED", "2:SENT"]);
      // "substituída" acontece antes de "enviada", e o histórico precisa poder dizer isso.
      const superseded = await prisma.auditLog.findFirstOrThrow({ where: { entityId: v1.id, action: "PROPOSAL_SUPERSEDED" } });
      const sentV2 = await prisma.auditLog.findFirstOrThrow({ where: { entityId: v2.id, action: "PROPOSAL_SENT" } });
      expect(superseded.createdAt.getTime()).toBeLessThan(sentV2.createdAt.getTime());
    });

    it("uma proposta substituída não pode ser aceita nem recusada", async () => {
      const { ctx } = await setup();
      const { opportunity } = await withOpportunity(ctx);
      const v1 = await sendOne(ctx, opportunity.id);
      const v2 = await make(ctx, opportunity.id);
      await act(ctx, v2.id, "SEND", v2.version);
      const superseded = await prisma.proposal.findUniqueOrThrow({ where: { id: v1.id } });

      await expect(act(ctx, v1.id, "ACCEPT", superseded.version)).rejects.toEqual(adminError(409));
      await expect(act(ctx, v1.id, "REJECT", superseded.version)).rejects.toEqual(adminError(409));
    });

    it("com a oportunidade ganha, perdida ou já convertida em evento: não envia", async () => {
      const { ctx } = await setup();
      const { opportunity } = await withOpportunity(ctx);
      const draft = await make(ctx, opportunity.id);
      await moveStage({ ...ctx, opportunityId: opportunity.id, input: { stage: "LOST", lostReason: "Sem orçamento", baseVersion: 1 } as never });

      await expect(act(ctx, draft.id, "SEND", draft.version)).rejects.toEqual(adminError(409));
      expect((await prisma.proposal.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe("DRAFT");
    });
  });

  describe("aceitar e recusar", () => {
    it("ACEITAR leva a oportunidade a 'Ganho' (fechada agora), registra a resposta e NÃO cria o evento", async () => {
      const { ctx } = await setup();
      const { opportunity } = await withOpportunity(ctx);
      const sent = await sendOne(ctx, opportunity.id);

      const { proposal, opportunity: won } = await act(ctx, sent.id, "ACCEPT", sent.version, "Fechado por telefone");

      expect(proposal).toMatchObject({ status: "ACCEPTED", decidedBy: ctx.userId, decisionNote: "Fechado por telefone" });
      expect(proposal!.decidedAt).toEqual(NOW);
      expect(won).toMatchObject({ stage: "WON", eventId: null, lostReason: null });
      expect(won.closedAt).toEqual(NOW);
      expect(await prisma.event.count()).toBe(0);
    });

    it("depois de aceita a oportunidade ganha pode virar evento normalmente — e aí as propostas ficam só para consulta", async () => {
      const { ctx } = await setup();
      const { opportunity } = await withOpportunity(ctx);
      const sent = await sendOne(ctx, opportunity.id);
      await act(ctx, sent.id, "ACCEPT", sent.version);
      const current = await prisma.opportunity.findUniqueOrThrow({ where: { id: opportunity.id } });

      await convertToEvent({ ...ctx, opportunityId: opportunity.id, input: { event: eventInput(), baseVersion: current.version } as never });

      await expect(make(ctx, opportunity.id)).rejects.toMatchObject({ status: 409, message: expect.stringContaining("virou um evento") });
      expect(await prisma.event.count()).toBe(1);
    });

    it("a validade vencida bloqueia o aceite (nova versão com nova validade); recusar continua possível", async () => {
      const { ctx } = await setup();
      const { opportunity } = await withOpportunity(ctx);
      const sent = await sendOne(ctx, opportunity.id, { validUntil: "2027-01-10" });
      const later = new Date("2027-01-11T15:00:00.000Z");

      await expect(
        changeProposalStatus({ ...ctx, proposalId: sent.id, input: { action: "ACCEPT", baseVersion: sent.version, note: null } as never, now: later })
      ).rejects.toMatchObject({ status: 409, message: expect.stringContaining("10/01/2027") });
      await expect(
        changeProposalStatus({ ...ctx, proposalId: sent.id, input: { action: "REJECT", baseVersion: sent.version, note: null } as never, now: later })
      ).resolves.toMatchObject({ proposal: { status: "REJECTED" } });
    });

    it("oportunidade perdida: não aceita (reabra antes) — mas a resposta 'recusada' ainda se registra", async () => {
      const { ctx } = await setup();
      const { opportunity } = await withOpportunity(ctx);
      const sent = await sendOne(ctx, opportunity.id);
      const current = await prisma.opportunity.findUniqueOrThrow({ where: { id: opportunity.id } });
      await moveStage({ ...ctx, opportunityId: opportunity.id, input: { stage: "LOST", lostReason: "Escolheu outra produtora", baseVersion: current.version } as never });

      await expect(act(ctx, sent.id, "ACCEPT", sent.version)).rejects.toMatchObject({ status: 409, message: expect.stringContaining("Reabra") });
      await expect(act(ctx, sent.id, "REJECT", sent.version)).resolves.toMatchObject({ proposal: { status: "REJECTED" } });
      expect(await stageOf(opportunity.id)).toBe("LOST");
    });

    it("oportunidade já ganha (movida à mão): aceitar registra a resposta sem mexer na etapa nem no fechamento", async () => {
      const { ctx } = await setup();
      const { opportunity } = await withOpportunity(ctx);
      const sent = await sendOne(ctx, opportunity.id);
      const current = await prisma.opportunity.findUniqueOrThrow({ where: { id: opportunity.id } });
      const won = await moveStage({ ...ctx, opportunityId: opportunity.id, input: { stage: "WON", lostReason: null, baseVersion: current.version } as never });

      const result = await act(ctx, sent.id, "ACCEPT", sent.version);

      expect(result.proposal!.status).toBe("ACCEPTED");
      expect(result.opportunity.version).toBe(won.version);
      expect(result.opportunity.closedAt).toEqual(won.closedAt);
    });

    it("RECUSAR registra o motivo e deixa a oportunidade onde está; depois dá para criar a próxima versão", async () => {
      const { ctx } = await setup();
      const { opportunity } = await withOpportunity(ctx);
      const sent = await sendOne(ctx, opportunity.id);

      const { proposal } = await act(ctx, sent.id, "REJECT", sent.version, "Achou caro");

      expect(proposal).toMatchObject({ status: "REJECTED", decisionNote: "Achou caro" });
      expect(await stageOf(opportunity.id)).toBe("PROPOSAL_SENT");
      await expect(make(ctx, opportunity.id, { copiedFromProposalId: sent.id })).resolves.toMatchObject({ number: 2, status: "DRAFT" });
    });

    it("decidida a proposta, não se decide de novo (aceita ↔ recusada) e não se descarta", async () => {
      const { ctx } = await setup();
      const { opportunity } = await withOpportunity(ctx);
      const sent = await sendOne(ctx, opportunity.id);
      const { proposal: accepted } = await act(ctx, sent.id, "ACCEPT", sent.version);

      for (const action of ["ACCEPT", "REJECT", "SEND", "DISCARD"] as const) {
        await expect(act(ctx, sent.id, action, accepted!.version), action).rejects.toEqual(adminError(409));
      }
      expect((await prisma.proposal.findUniqueOrThrow({ where: { id: sent.id } })).status).toBe("ACCEPTED");
    });

    it("aceitar/recusar um RASCUNHO não é possível (primeiro se envia)", async () => {
      const { ctx } = await setup();
      const { opportunity } = await withOpportunity(ctx);
      const draft = await make(ctx, opportunity.id);

      await expect(act(ctx, draft.id, "ACCEPT", draft.version)).rejects.toEqual(adminError(409));
      await expect(act(ctx, draft.id, "REJECT", draft.version)).rejects.toEqual(adminError(409));
    });
  });

  describe("descartar", () => {
    it("apaga o rascunho e os itens; fica a linha na auditoria", async () => {
      const { ctx } = await setup();
      const { opportunity } = await withOpportunity(ctx);
      const draft = await make(ctx, opportunity.id);

      const { proposal } = await act(ctx, draft.id, "DISCARD", draft.version);

      expect(proposal).toBeNull();
      expect(await prisma.proposal.count()).toBe(0);
      expect(await prisma.proposalItem.count()).toBe(0);
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: draft.id, action: "PROPOSAL_DISCARDED" } });
      expect(audit.beforeJson).toMatchObject({ number: 1, totalCents: 1_100_000 });
    });

    it("proposta enviada NÃO se descarta (fica no histórico)", async () => {
      const { ctx } = await setup();
      const { opportunity } = await withOpportunity(ctx);
      const sent = await sendOne(ctx, opportunity.id);

      await expect(act(ctx, sent.id, "DISCARD", sent.version)).rejects.toEqual(adminError(409));
      expect(await prisma.proposal.count()).toBe(1);
    });

    it("descartar é possível mesmo com a oportunidade perdida (limpeza)", async () => {
      const { ctx } = await setup();
      const { opportunity } = await withOpportunity(ctx);
      const draft = await make(ctx, opportunity.id);
      await moveStage({ ...ctx, opportunityId: opportunity.id, input: { stage: "LOST", lostReason: "Sem orçamento", baseVersion: 1 } as never });

      await expect(act(ctx, draft.id, "DISCARD", draft.version)).resolves.toMatchObject({ proposal: null });
    });

    it("com a versão velha, 409 e o rascunho continua", async () => {
      const { ctx } = await setup();
      const { opportunity } = await withOpportunity(ctx);
      const draft = await make(ctx, opportunity.id);
      await updateProposal({ ...ctx, proposalId: draft.id, input: { ...(proposalInput() as object), baseVersion: 1 } as never });

      await expect(act(ctx, draft.id, "DISCARD", 1)).rejects.toMatchObject({ status: 409, message: expect.stringContaining("alterada por outra pessoa") });
      expect(await prisma.proposal.count()).toBe(1);
    });
  });

  describe("leitura e histórico", () => {
    it("o histórico da oportunidade conta a história das propostas em palavras, do mais novo ao mais antigo", async () => {
      const { ctx } = await setup();
      const { opportunity } = await withOpportunity(ctx);
      const v1 = await sendOne(ctx, opportunity.id);
      const v2 = await make(ctx, opportunity.id, { copiedFromProposalId: v1.id });
      await act(ctx, v2.id, "SEND", v2.version);
      const sent2 = await prisma.proposal.findUniqueOrThrow({ where: { id: v2.id } });
      await act(ctx, v2.id, "ACCEPT", sent2.version, "Aprovado pela diretoria");

      const { history } = await getOpportunity({ ...ctx, opportunityId: opportunity.id });

      // O que aconteceu junto (na mesma transação) sai na ordem certa: a última coisa primeiro.
      const eleven = "R$ 11.000,00";
      expect(history.map((h) => h.text)).toEqual([
        "Etapa: Proposta enviada → Ganho (pela proposta v2)",
        "Proposta v2 aceita pelo cliente — Aprovado pela diretoria.",
        `Proposta v2 marcada como enviada (${eleven}, válida até 31/01/2027).`,
        "Proposta v1 substituída pela v2.",
        "Proposta v2 criada a partir da v1.",
        "Etapa: Novo → Proposta enviada (pela proposta v1)",
        `Proposta v1 marcada como enviada (${eleven}, válida até 31/01/2027).`,
        "Proposta v1 criada.",
        "Oportunidade criada.",
      ]);
    });

    it("o histórico de UMA proposta traz só o que é dela", async () => {
      const { ctx } = await setup();
      const { opportunity } = await withOpportunity(ctx);
      const v1 = await sendOne(ctx, opportunity.id);
      const v2 = await make(ctx, opportunity.id);

      const detail = await getProposal({ ...ctx, proposalId: v2.id, now: NOW });

      expect(detail.history.map((h) => h.text)).toEqual(["Proposta v2 criada."]);
      expect(detail.versions.map((v) => `${v.number}:${v.status}`)).toEqual(["2:DRAFT", "1:SENT"]);
      expect(detail.draftId).toBe(v2.id);
      expect(detail.client.name).toBeTruthy();
      expect(v1.id).not.toBe(v2.id);
    });

    it("a lista de uma oportunidade traz as versões (novas primeiro), o rascunho e se dá para criar outra", async () => {
      const { ctx } = await setup();
      const { opportunity } = await withOpportunity(ctx);
      const v1 = await sendOne(ctx, opportunity.id);
      const v2 = await make(ctx, opportunity.id);

      const list = await listOpportunityProposals({ ...ctx, opportunityId: opportunity.id, now: NOW });

      expect(list.rows.map((r) => [r.number, r.status, r.totalCents, r.validUntil, r.itemCount])).toEqual([
        [2, "DRAFT", 1_100_000, STILL_VALID, 2],
        [1, "SENT", 1_100_000, STILL_VALID, 2],
      ]);
      expect(list.draftId).toBe(v2.id);
      expect(list.createBlockedReason).toBeNull();
      expect(v1.number).toBe(1);
    });

    it("a lista da empresa: as ENVIADAS por validade (as que vencem primeiro no topo), com o aviso de vencida", async () => {
      const { ctx } = await setup();
      const later = await withOpportunity(ctx, { title: "Vence depois" });
      const sooner = await withOpportunity(ctx, { title: "Vence antes" });
      const past = await withOpportunity(ctx, { title: "Já venceu" });
      await sendOne(ctx, later.opportunity.id, { validUntil: "2027-03-01" });
      await sendOne(ctx, sooner.opportunity.id, { validUntil: "2027-01-10" });
      const old = await sendOne(ctx, past.opportunity.id, { validUntil: "2027-01-05" });
      await prisma.proposal.update({ where: { id: old.id }, data: { validUntil: new Date("2027-01-04T00:00:00.000Z") } });
      await make(ctx, (await withOpportunity(ctx)).opportunity.id);

      const { rows } = await listProposals({ ...ctx, status: "SENT", now: NOW });

      expect(rows.map((r) => [r.opportunityTitle, r.validUntil, r.expired])).toEqual([
        ["Já venceu", "2027-01-04", true],
        ["Vence antes", "2027-01-10", false],
        ["Vence depois", "2027-03-01", false],
      ]);
      expect((await listProposals({ ...ctx, now: NOW })).rows).toHaveLength(4);
      expect((await listProposals({ ...ctx, status: "DRAFT", now: NOW })).rows).toHaveLength(1);
    });

    it("preparar uma nova proposta: copia uma versão só da MESMA oportunidade e avisa de rascunho existente ou bloqueio", async () => {
      const { ctx } = await setup();
      const { opportunity } = await withOpportunity(ctx);
      const other = await withOpportunity(ctx);
      const v1 = await sendOne(ctx, opportunity.id, { notes: "Condições da v1" });
      const foreign = await sendOne(ctx, other.opportunity.id);

      const copy = await prepareNewProposal({ ...ctx, opportunityId: opportunity.id, copyFromProposalId: v1.id });
      expect(copy.copiedFrom).toEqual({ id: v1.id, number: 1 });
      expect(copy.initial).toMatchObject({ discountCents: 50_000, notes: "Condições da v1" });
      expect(copy.initial!.items).toHaveLength(2);

      const stranger = await prepareNewProposal({ ...ctx, opportunityId: opportunity.id, copyFromProposalId: foreign.id });
      expect(stranger.initial).toBeNull();

      const draft = await make(ctx, opportunity.id);
      expect((await prepareNewProposal({ ...ctx, opportunityId: opportunity.id })).existingDraft).toEqual({ id: draft.id, number: 2 });
    });
  });

  describe("concorrência (cada uma repetida em várias rodadas)", () => {
    const ROUNDS = 8;

    it("dois 'criar proposta' ao mesmo tempo: um rascunho só, número 1", async () => {
      for (let round = 0; round < ROUNDS; round++) {
        await truncateAll(prisma);
        const { ctx } = await setup();
        const { opportunity } = await withOpportunity(ctx);

        const results = await Promise.allSettled([make(ctx, opportunity.id), make(ctx, opportunity.id), make(ctx, opportunity.id)]);

        expect(results.filter((r) => r.status === "fulfilled"), `rodada ${round}`).toHaveLength(1);
        for (const r of results.filter((r) => r.status === "rejected")) expect(r.reason).toEqual(adminError(409));
        expect(await statuses(opportunity.id)).toEqual(["1:DRAFT"]);
      }
    });

    it("dois 'enviar' do mesmo rascunho: um só envia", async () => {
      for (let round = 0; round < ROUNDS; round++) {
        await truncateAll(prisma);
        const { ctx } = await setup();
        const { opportunity } = await withOpportunity(ctx);
        const draft = await make(ctx, opportunity.id);

        const results = await Promise.allSettled([act(ctx, draft.id, "SEND", 1), act(ctx, draft.id, "SEND", 1)]);

        expect(results.filter((r) => r.status === "fulfilled"), `rodada ${round}`).toHaveLength(1);
        expect(await statuses(opportunity.id)).toEqual(["1:SENT"]);
        expect(await prisma.auditLog.count({ where: { action: "PROPOSAL_SENT" } })).toBe(1);
      }
    });

    it("aceitar × recusar a mesma proposta: só uma resposta vale, e a etapa é coerente com ela", async () => {
      for (let round = 0; round < ROUNDS; round++) {
        await truncateAll(prisma);
        const { ctx } = await setup();
        const { opportunity } = await withOpportunity(ctx);
        const sent = await sendOne(ctx, opportunity.id);

        const results = await Promise.allSettled([act(ctx, sent.id, "ACCEPT", sent.version), act(ctx, sent.id, "REJECT", sent.version)]);

        expect(results.filter((r) => r.status === "fulfilled"), `rodada ${round}`).toHaveLength(1);
        const final = (await prisma.proposal.findUniqueOrThrow({ where: { id: sent.id } })).status;
        expect(["ACCEPTED", "REJECTED"]).toContain(final);
        expect(await stageOf(opportunity.id), `rodada ${round}`).toBe(final === "ACCEPTED" ? "WON" : "PROPOSAL_SENT");
      }
    });

    it("editar × enviar o mesmo rascunho: nunca se envia um conteúdo diferente do que quem enviou viu", async () => {
      for (let round = 0; round < ROUNDS; round++) {
        await truncateAll(prisma);
        const { ctx } = await setup();
        const { opportunity } = await withOpportunity(ctx);
        const draft = await make(ctx, opportunity.id);

        const results = await Promise.allSettled([
          updateProposal({ ...ctx, proposalId: draft.id, input: { ...(proposalInput() as object), notes: "editada", baseVersion: 1 } as never }),
          act(ctx, draft.id, "SEND", 1),
        ]);

        // Os dois partem da versão 1: se um vence, o outro enxerga a versão nova (ou o rascunho já enviado) e recebe 409.
        expect(results.filter((r) => r.status === "fulfilled"), `rodada ${round}`).toHaveLength(1);
        // Enviada: com o conteúdo ORIGINAL (o que quem enviou viu); senão, a edição ficou e ainda é rascunho.
        const stored = await prisma.proposal.findUniqueOrThrow({ where: { id: draft.id } });
        expect(stored.status === "SENT" ? stored.notes === null : stored.status === "DRAFT" && stored.notes === "editada", `rodada ${round}`).toBe(true);
      }
    });

    it("enviar a v2 × aceitar a v1: nunca sobram uma aceita e uma enviada ao mesmo tempo", async () => {
      for (let round = 0; round < ROUNDS; round++) {
        await truncateAll(prisma);
        const { ctx } = await setup();
        const { opportunity } = await withOpportunity(ctx);
        const v1 = await sendOne(ctx, opportunity.id);
        const v2 = await make(ctx, opportunity.id);

        await Promise.allSettled([act(ctx, v2.id, "SEND", v2.version), act(ctx, v1.id, "ACCEPT", v1.version)]);

        const state = await statuses(opportunity.id);
        expect(
          state.some((s) => s.endsWith(":SENT")) && state.some((s) => s.endsWith(":ACCEPTED")),
          `rodada ${round}: ${state.join(", ")}`
        ).toBe(false);
        expect(state.filter((s) => s.endsWith(":SENT")).length).toBeLessThanOrEqual(1);
      }
    });

    it("aceitar × perder a oportunidade ao mesmo tempo: o resultado é sempre coerente", async () => {
      for (let round = 0; round < ROUNDS; round++) {
        await truncateAll(prisma);
        const { ctx } = await setup();
        const { opportunity } = await withOpportunity(ctx);
        const sent = await sendOne(ctx, opportunity.id);
        const current = await prisma.opportunity.findUniqueOrThrow({ where: { id: opportunity.id } });

        await Promise.allSettled([
          act(ctx, sent.id, "ACCEPT", sent.version),
          moveStage({ ...ctx, opportunityId: opportunity.id, input: { stage: "LOST", lostReason: "Sem orçamento", baseVersion: current.version } as never }),
        ]);

        const stage = await stageOf(opportunity.id);
        const proposal = (await prisma.proposal.findUniqueOrThrow({ where: { id: sent.id } })).status;
        // Aceita só com a oportunidade ganha; perdida nunca fica com uma proposta aceita.
        expect(stage === "LOST" && proposal === "ACCEPTED", `rodada ${round}: ${stage}/${proposal}`).toBe(false);
        expect(proposal === "ACCEPTED" ? stage : "WON", `rodada ${round}`).toBe("WON");
      }
    });
  });
});
