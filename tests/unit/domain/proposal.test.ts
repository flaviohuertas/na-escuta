import { describe, expect, it } from "vitest";
import { describeOpportunityHistory } from "@/lib/domain/crm";
import {
  PROPOSAL_STATUSES,
  allowedProposalActions,
  computeTotals,
  dateOnlyFromDate,
  dateOnlyToDate,
  describeProposalHistory,
  explainBlockedProposalAction,
  explainBlockedProposalCreate,
  formatDateOnlyBR,
  isExpired,
  isValidDateOnly,
  stageAfterSend,
  todayInSaoPaulo,
  totalsProblems,
  type ProposalActionName,
  type ProposalContext,
} from "@/lib/domain/proposal";

describe("totais — sempre em centavos inteiros", () => {
  it("cada item = quantidade × preço; subtotal = soma; total = subtotal − desconto", () => {
    const totals = computeTotals(
      [
        { quantity: 2, unitPriceCents: 500_000 },
        { quantity: 1, unitPriceCents: 150_000 },
      ],
      50_000
    );
    expect(totals).toEqual({ lineTotals: [1_000_000, 150_000], subtotalCents: 1_150_000, discountCents: 50_000, totalCents: 1_100_000 });
  });

  it("não perde centavo: 3 × R$ 0,10 é R$ 0,30 (e não 0,30000000000000004)", () => {
    expect(computeTotals([{ quantity: 3, unitPriceCents: 10 }], 0).totalCents).toBe(30);
    expect(computeTotals([{ quantity: 7, unitPriceCents: 1 }], 0).totalCents).toBe(7);
  });

  it("sem itens o total é zero (a validação é que exige item)", () => {
    expect(computeTotals([], 0)).toEqual({ lineTotals: [], subtotalCents: 0, discountCents: 0, totalCents: 0 });
  });

  describe("problemas nos valores", () => {
    it("valores dentro dos limites: nenhum problema — inclusive desconto igual ao subtotal", () => {
      expect(totalsProblems([{ quantity: 2, unitPriceCents: 500 }], 1000)).toEqual([]);
      expect(totalsProblems([], 0)).toEqual([]);
    });

    it("um item acima de R$ 20 milhões aponta O ITEM (pelo caminho)", () => {
      const problems = totalsProblems(
        [
          { quantity: 1, unitPriceCents: 100 },
          { quantity: 100_000, unitPriceCents: 1_000_000 },
        ],
        0
      );
      expect(problems.some((p) => p.path.join(".") === "items.1.unitPriceCents")).toBe(true);
    });

    it("itens que passam do teto SOMADOS apontam o subtotal", () => {
      const half = { quantity: 1, unitPriceCents: 1_500_000_000 };
      expect(totalsProblems([half, half], 0).map((p) => p.path.join("."))).toEqual(["items"]);
    });

    it("desconto maior que o subtotal aponta o desconto", () => {
      expect(totalsProblems([{ quantity: 1, unitPriceCents: 1000 }], 1001).map((p) => p.path.join("."))).toEqual(["discountCents"]);
    });
  });
});

describe("validade — só a data, no horário de Brasília", () => {
  it("'hoje' é o dia de Brasília, não o do servidor (UTC): 01h UTC ainda é o dia anterior aqui", () => {
    expect(todayInSaoPaulo(new Date("2027-01-05T01:00:00.000Z"))).toBe("2027-01-04");
    expect(todayInSaoPaulo(new Date("2027-01-05T02:59:59.000Z"))).toBe("2027-01-04");
    expect(todayInSaoPaulo(new Date("2027-01-05T03:00:00.000Z"))).toBe("2027-01-05");
    expect(todayInSaoPaulo(new Date("2027-01-05T23:59:00.000Z"))).toBe("2027-01-05");
  });

  it("só aceita um dia que EXISTE de verdade", () => {
    expect(isValidDateOnly("2027-01-10")).toBe(true);
    expect(isValidDateOnly("2028-02-29")).toBe(true);
    for (const bad of ["2027-02-29", "2027-13-01", "2027-00-10", "2027-1-10", "10/01/2027", "2027-01-10T00:00:00Z", "", "amanhã"]) {
      expect(isValidDateOnly(bad), bad).toBe(false);
    }
  });

  it("a data que o banco devolve (meia-noite UTC) vira o mesmo dia — sem escorregar para o dia anterior", () => {
    expect(dateOnlyFromDate(new Date("2027-01-10T00:00:00.000Z"))).toBe("2027-01-10");
    expect(dateOnlyFromDate(dateOnlyToDate("2027-12-31"))).toBe("2027-12-31");
  });

  it("formata como a pessoa lê, sem fuso: 10/01/2027", () => {
    expect(formatDateOnlyBR("2027-01-10")).toBe("10/01/2027");
    expect(formatDateOnlyBR(null)).toBe("—");
    expect(formatDateOnlyBR("lixo")).toBe("—");
  });

  it("o último dia ainda vale; vence só no dia seguinte; sem validade nunca vence", () => {
    expect(isExpired("2027-01-05", "2027-01-05")).toBe(false);
    expect(isExpired("2027-01-05", "2027-01-06")).toBe(true);
    expect(isExpired("2027-01-05", "2027-01-04")).toBe(false);
    expect(isExpired(null, "2099-01-01")).toBe(false);
  });
});

describe("o que cada situação permite", () => {
  const ctx = (overrides: Partial<ProposalContext> = {}): ProposalContext => ({
    status: "DRAFT",
    oppStage: "NEW",
    hasEvent: false,
    validUntil: "2027-01-31",
    today: "2027-01-05",
    itemCount: 2,
    totalCents: 1_100_000,
    ...overrides,
  });
  const blocked = (action: ProposalActionName, overrides: Partial<ProposalContext> = {}) => explainBlockedProposalAction(action, ctx(overrides));

  describe("rascunho", () => {
    it("edita, envia e descarta", () => {
      expect(allowedProposalActions(ctx())).toEqual(["EDIT", "SEND", "DISCARD"]);
    });

    it("enviar exige itens, total maior que zero e validade que ainda vale — e diz o que falta", () => {
      expect(blocked("SEND", { itemCount: 0 })).toMatch(/ao menos um item/);
      expect(blocked("SEND", { totalCents: 0 })).toMatch(/maior que zero/);
      expect(blocked("SEND", { validUntil: null })).toMatch(/até quando a proposta vale/);
      expect(blocked("SEND", { validUntil: "2027-01-04" })).toMatch(/04\/01\/2027/);
      expect(blocked("SEND", { validUntil: "2027-01-05" })).toBeNull();
    });

    it("editar e enviar exigem a oportunidade EM ANDAMENTO; descartar não (é só limpeza)", () => {
      for (const oppStage of ["WON", "LOST"]) {
        expect(blocked("EDIT", { oppStage }), oppStage).toMatch(/Reabra/);
        expect(blocked("SEND", { oppStage }), oppStage).toMatch(/Reabra/);
        expect(blocked("DISCARD", { oppStage }), oppStage).toBeNull();
      }
      expect(blocked("EDIT", { hasEvent: true })).toMatch(/virou um evento/);
      expect(blocked("SEND", { hasEvent: true })).toMatch(/virou um evento/);
      expect(blocked("DISCARD", { hasEvent: true })).toBeNull();
    });

    it("não se aceita nem se recusa um rascunho", () => {
      expect(blocked("ACCEPT")).toMatch(/enviada/);
      expect(blocked("REJECT")).toMatch(/enviada/);
    });
  });

  describe("enviada", () => {
    const sent = (overrides: Partial<ProposalContext> = {}) => ({ status: "SENT", ...overrides });

    it("aceita e recusa — e mais nada (não edita, não reenvia, não descarta)", () => {
      expect(allowedProposalActions(ctx(sent()))).toEqual(["ACCEPT", "REJECT"]);
      expect(blocked("EDIT", sent())).toMatch(/nova versão/);
      expect(blocked("SEND", sent())).toMatch(/não é mais um rascunho/);
      expect(blocked("DISCARD", sent())).toMatch(/histórico/);
    });

    it("com a validade vencida não aceita (pede nova versão), mas ainda recusa", () => {
      const expired = sent({ validUntil: "2027-01-04" });
      expect(blocked("ACCEPT", expired)).toMatch(/venceu em 04\/01\/2027.*nova versão/);
      expect(blocked("REJECT", expired)).toBeNull();
    });

    it("oportunidade perdida: não aceita (reabra antes); ganha (movida à mão): aceita", () => {
      expect(blocked("ACCEPT", sent({ oppStage: "LOST" }))).toMatch(/Reabra/);
      expect(blocked("ACCEPT", sent({ oppStage: "WON" }))).toBeNull();
      expect(blocked("REJECT", sent({ oppStage: "LOST" }))).toBeNull();
    });

    it("depois de virar evento nada muda", () => {
      expect(blocked("ACCEPT", sent({ hasEvent: true }))).toMatch(/virou um evento/);
      expect(blocked("REJECT", sent({ hasEvent: true }))).toMatch(/virou um evento/);
    });
  });

  it("aceita, recusada e substituída são finais: nenhuma ação", () => {
    for (const status of ["ACCEPTED", "REJECTED", "SUPERSEDED"]) {
      expect(allowedProposalActions(ctx({ status })), status).toEqual([]);
    }
  });

  it("situação desconhecida: tudo bloqueado (falha fechada)", () => {
    expect(allowedProposalActions(ctx({ status: "QUALQUER" }))).toEqual([]);
    expect(blocked("SEND", { status: "QUALQUER" })).toMatch(/desconhecida/);
  });

  it("todas as situações têm rótulo e a lista bate com o schema do banco", () => {
    expect([...PROPOSAL_STATUSES]).toEqual(["DRAFT", "SENT", "ACCEPTED", "REJECTED", "SUPERSEDED"]);
  });

  it("criar: só com a oportunidade em andamento e sem evento", () => {
    expect(explainBlockedProposalCreate({ oppStage: "NEGOTIATION", hasEvent: false })).toBeNull();
    expect(explainBlockedProposalCreate({ oppStage: "WON", hasEvent: false })).toMatch(/ganha/);
    expect(explainBlockedProposalCreate({ oppStage: "LOST", hasEvent: false })).toMatch(/perdida/);
    expect(explainBlockedProposalCreate({ oppStage: "NEW", hasEvent: true })).toMatch(/virou um evento/);
  });
});

describe("enviar leva a oportunidade para 'Proposta enviada' — só para a frente", () => {
  it("de Novo e Em contato avança; de Negociação, Ganho, Perdido e da própria etapa, não", () => {
    expect(stageAfterSend("NEW")).toBe("PROPOSAL_SENT");
    expect(stageAfterSend("CONTACTED")).toBe("PROPOSAL_SENT");
    for (const stage of ["PROPOSAL_SENT", "NEGOTIATION", "WON", "LOST"]) expect(stageAfterSend(stage), stage).toBeNull();
  });
});

describe("histórico em palavras", () => {
  const snap = (overrides: Record<string, unknown> = {}) => ({
    number: 2,
    status: "SENT",
    validUntil: "2027-01-31",
    notes: null,
    discountCents: 0,
    totalCents: 1_100_000,
    items: [{ description: "Som", quantity: 1, unitPriceCents: 1_100_000 }],
    ...overrides,
  });

  it("cada ação tem a sua frase", () => {
    expect(describeProposalHistory("PROPOSAL_CREATED", null, snap())).toBe("Proposta v2 criada.");
    expect(describeProposalHistory("PROPOSAL_CREATED", null, snap(), { copiedFromNumber: 1 })).toBe("Proposta v2 criada a partir da v1.");
    expect(describeProposalHistory("PROPOSAL_SENT", snap(), snap())).toBe("Proposta v2 marcada como enviada (R$ 11.000,00, válida até 31/01/2027).");
    expect(describeProposalHistory("PROPOSAL_SUPERSEDED", snap(), snap(), { supersededByNumber: 3 })).toBe("Proposta v2 substituída pela v3.");
    expect(describeProposalHistory("PROPOSAL_ACCEPTED", snap(), snap(), { note: "Por telefone" })).toBe("Proposta v2 aceita pelo cliente — Por telefone.");
    expect(describeProposalHistory("PROPOSAL_ACCEPTED", snap(), snap(), { note: null })).toBe("Proposta v2 aceita pelo cliente.");
    expect(describeProposalHistory("PROPOSAL_REJECTED", snap(), snap(), { note: "Achou caro" })).toBe("Proposta v2 recusada pelo cliente — Achou caro.");
    expect(describeProposalHistory("PROPOSAL_DISCARDED", snap(), null)).toBe("Rascunho da proposta v2 descartado.");
  });

  it("a edição diz O QUE mudou", () => {
    const before = snap({ discountCents: 0 });
    expect(describeProposalHistory("PROPOSAL_UPDATED", before, snap({ discountCents: 5000, notes: "3x" }))).toBe("Proposta v2 editada: desconto, observações.");
    expect(describeProposalHistory("PROPOSAL_UPDATED", before, snap({ items: [{ description: "Outro", quantity: 1, unitPriceCents: 1 }], validUntil: "2027-02-01" }))).toBe(
      "Proposta v2 editada: itens, validade."
    );
    expect(describeProposalHistory("PROPOSAL_UPDATED", before, before)).toBe("Proposta v2 editada.");
  });

  it("ação desconhecida sai como veio (nunca some) e dados ausentes não quebram", () => {
    expect(describeProposalHistory("PROPOSAL_ALGO_NOVO", null, null)).toBe("PROPOSAL_ALGO_NOVO");
    expect(describeProposalHistory("PROPOSAL_CREATED", null, null)).toBe("Proposta v? criada.");
    expect(describeProposalHistory("PROPOSAL_SENT", null, {})).toBe("Proposta v? marcada como enviada.");
  });

  it("a etapa que mudou por causa de uma proposta diz qual", () => {
    expect(describeOpportunityHistory("OPPORTUNITY_STAGE_CHANGED", { stage: "NEW" }, { stage: "PROPOSAL_SENT" }, { viaProposalNumber: 1 })).toBe(
      "Etapa: Novo → Proposta enviada (pela proposta v1)"
    );
    expect(describeOpportunityHistory("OPPORTUNITY_STAGE_CHANGED", { stage: "NEW" }, { stage: "CONTACTED" })).toBe("Etapa: Novo → Em contato");
  });
});
