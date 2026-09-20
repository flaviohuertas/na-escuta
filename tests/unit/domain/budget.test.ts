import { describe, expect, it } from "vitest";
import {
  BUDGET_CATEGORIES,
  budgetProblems,
  categoryLabel,
  computeBudgetTotals,
  computeMargin,
  describeBudgetHistory,
  explainBlockedBudgetEdit,
  formatBps,
  pickRevenueReference,
} from "@/lib/domain/budget";
import { canManageBudget, canManageCrm } from "@/lib/domain/permissions";

const line = (category: string, quantity: number, unitCostCents: number) => ({ category, quantity, unitCostCents });

describe("totais do orçamento — sempre em centavos inteiros", () => {
  it("cada item = quantidade × custo; total = soma; e o subtotal de cada categoria", () => {
    const totals = computeBudgetTotals([line("AV", 2, 300_000), line("STAFF", 10, 20_000), line("AV", 1, 50_050)]);

    expect(totals.lineTotals).toEqual([600_000, 200_000, 50_050]);
    expect(totals.totalCents).toBe(850_050);
    expect(totals.byCategory).toEqual([
      { category: "AV", subtotalCents: 650_050, itemCount: 2 },
      { category: "STAFF", subtotalCents: 200_000, itemCount: 1 },
    ]);
  });

  it("as categorias saem na ordem do orçamento (não na ordem em que os itens foram digitados) e só as que têm item", () => {
    const totals = computeBudgetTotals([line("OTHER", 1, 100), line("PERMITS", 1, 200), line("STRUCTURE", 1, 300)]);

    expect(totals.byCategory.map((group) => group.category)).toEqual(["STRUCTURE", "PERMITS", "OTHER"]);
  });

  it("uma categoria que não conhecemos (futura) entra por último — o dinheiro dela não some do total", () => {
    const totals = computeBudgetTotals([line("FUTURA", 2, 1000), line("AV", 1, 500)]);

    expect(totals.totalCents).toBe(2500);
    expect(totals.byCategory.map((group) => [group.category, group.subtotalCents])).toEqual([
      ["AV", 500],
      ["FUTURA", 2000],
    ]);
  });

  it("não perde centavo e o total bate com a soma dos subtotais", () => {
    const items = [line("FOOD", 3, 10), line("FOOD", 7, 1), line("STAFF", 13, 7)];
    const totals = computeBudgetTotals(items);

    expect(totals.totalCents).toBe(30 + 7 + 91);
    expect(totals.byCategory.reduce((sum, group) => sum + group.subtotalCents, 0)).toBe(totals.totalCents);
  });

  it("sem itens: total zero e nenhuma categoria", () => {
    expect(computeBudgetTotals([])).toEqual({ lineTotals: [], totalCents: 0, byCategory: [] });
  });

  it("cada categoria tem um rótulo em português e o código desconhecido aparece como veio", () => {
    expect(BUDGET_CATEGORIES.map((c) => c.code)).toEqual(["STRUCTURE", "AV", "FOOD", "STAFF", "SECURITY", "LOGISTICS", "VENUE", "MARKETING", "PERMITS", "OTHER"]);
    expect(categoryLabel("AV")).toBe("Som, luz e imagem");
    expect(categoryLabel("FUTURA")).toBe("FUTURA");
  });

  describe("problemas nos valores", () => {
    it("dentro dos limites: nenhum", () => {
      expect(budgetProblems([line("AV", 2, 500)])).toEqual([]);
      expect(budgetProblems([])).toEqual([]);
    });

    it("um item acima de R$ 20 milhões aponta O ITEM (pelo caminho)", () => {
      const problems = budgetProblems([line("AV", 1, 100), line("AV", 100_000, 1_000_000)]);
      expect(problems.map((p) => p.path.join("."))).toContain("items.1.unitCostCents");
    });

    it("itens que passam do teto SOMADOS apontam o total", () => {
      const half = line("AV", 1, 1_500_000_000);
      expect(budgetProblems([half, half]).map((p) => p.path.join("."))).toEqual(["items"]);
    });
  });
});

describe("receita de referência — a mais firme que existe", () => {
  const proposal = (number: number, status: string, totalCents: number) => ({ number, status, totalCents });

  it("aceita > enviada > rascunho > valor estimado > nada", () => {
    const all = [proposal(1, "DRAFT", 100), proposal(2, "SENT", 200), proposal(3, "ACCEPTED", 300)];

    expect(pickRevenueReference(all, 999)).toEqual({ kind: "ACCEPTED", cents: 300, label: "Proposta v3 (aceita)", proposalNumber: 3 });
    expect(pickRevenueReference(all.slice(0, 2), 999)).toMatchObject({ kind: "SENT", cents: 200, label: "Proposta v2 (enviada)" });
    expect(pickRevenueReference(all.slice(0, 1), 999)).toMatchObject({ kind: "DRAFT", cents: 100, label: "Proposta v1 (rascunho)" });
    expect(pickRevenueReference([], 999)).toEqual({ kind: "ESTIMATE", cents: 999, label: "Valor estimado da oportunidade", proposalNumber: null });
    expect(pickRevenueReference([], null)).toBeNull();
  });

  it("recusada e substituída não são receita (voltam para a estimativa)", () => {
    expect(pickRevenueReference([proposal(1, "REJECTED", 500), proposal(2, "SUPERSEDED", 600)], 400)).toMatchObject({ kind: "ESTIMATE", cents: 400 });
    expect(pickRevenueReference([proposal(1, "REJECTED", 500)], null)).toBeNull();
  });

  it("entre rascunhos (ou enviadas) iguais vale o de número mais novo", () => {
    expect(pickRevenueReference([proposal(1, "DRAFT", 100), proposal(4, "DRAFT", 400), proposal(2, "DRAFT", 200)], null)).toMatchObject({ cents: 400, proposalNumber: 4 });
  });

  it("uma estimativa de zero ainda é uma estimativa (não é o mesmo que 'sem valor')", () => {
    expect(pickRevenueReference([], 0)).toMatchObject({ kind: "ESTIMATE", cents: 0 });
  });
});

describe("margem", () => {
  it("receita − custo, e o percentual sobre a receita em pontos-base, arredondado", () => {
    expect(computeMargin(1_200_000, 800_000)).toEqual({ marginCents: 400_000, marginBps: 3333 });
    expect(computeMargin(1_050_000, 800_000)).toEqual({ marginCents: 250_000, marginBps: 2381 });
    expect(computeMargin(1000, 0)).toEqual({ marginCents: 1000, marginBps: 10000 });
  });

  it("prejuízo é negativo (nunca zerado nem escondido)", () => {
    expect(computeMargin(500_000, 800_000)).toEqual({ marginCents: -300_000, marginBps: -6000 });
  });

  it("receita zero: a margem em reais existe, o percentual não (sem divisão por zero)", () => {
    expect(computeMargin(0, 800_000)).toEqual({ marginCents: -800_000, marginBps: null });
    expect(computeMargin(0, 0)).toEqual({ marginCents: 0, marginBps: null });
  });

  it("formata como a pessoa lê, com vírgula", () => {
    expect(formatBps(3333)).toBe("33,3%");
    expect(formatBps(-6000)).toBe("-60,0%");
    expect(formatBps(10000)).toBe("100,0%");
    expect(formatBps(0)).toBe("0,0%");
  });
});

describe("quando dá para editar", () => {
  it("em andamento e ganha (sem evento): sim; perdida, evento e etapa desconhecida: não — e diz por quê", () => {
    for (const oppStage of ["NEW", "CONTACTED", "PROPOSAL_SENT", "NEGOTIATION", "WON"]) {
      expect(explainBlockedBudgetEdit({ oppStage, hasEvent: false }), oppStage).toBeNull();
    }
    expect(explainBlockedBudgetEdit({ oppStage: "LOST", hasEvent: false })).toMatch(/perdida.*Reabra/);
    expect(explainBlockedBudgetEdit({ oppStage: "WON", hasEvent: true })).toMatch(/virou um evento/);
    expect(explainBlockedBudgetEdit({ oppStage: "NEW", hasEvent: true })).toMatch(/só para consulta/);
    expect(explainBlockedBudgetEdit({ oppStage: "QUALQUER", hasEvent: false })).toMatch(/desconhecida/);
  });
});

describe("quem vê o orçamento (regra própria, mais estreita que a do comercial, falha fechada)", () => {
  it("só titular e administração — a produção cuida do comercial mas NÃO vê custo nem margem", () => {
    for (const role of ["OWNER", "ADMIN"]) expect(canManageBudget(role), role).toBe(true);
    for (const role of ["PRODUCER", "STAFF", "FREELANCER", "VIEWER", "", "owner", "QUALQUER"]) expect(canManageBudget(role), role).toBe(false);
  });

  it("é MAIS ESTREITA que a do comercial: quem vê o orçamento sempre cuida do comercial, e a produção só o comercial", () => {
    for (const role of ["OWNER", "ADMIN", "PRODUCER", "STAFF", "FREELANCER", "VIEWER"]) {
      if (canManageBudget(role)) expect(canManageCrm(role), role).toBe(true);
    }
    expect(canManageCrm("PRODUCER")).toBe(true);
    expect(canManageBudget("PRODUCER")).toBe(false);
  });
});

describe("histórico em palavras", () => {
  const snap = (items: Array<{ quantity: number; unitCostCents: number }>, notes: string | null = null) => ({
    notes,
    items: items.map((item) => ({ category: "AV", description: "x", supplier: null, ...item })),
  });

  it("criado: diz o custo previsto", () => {
    expect(describeBudgetHistory("BUDGET_CREATED", null, snap([{ quantity: 2, unitCostCents: 400_000 }]))).toBe("Orçamento criado (custo previsto de R$ 8.000,00).");
    expect(describeBudgetHistory("BUDGET_CREATED", null, null)).toBe("Orçamento criado.");
  });

  it("editado: diz o que mudou, com o custo de antes e de depois", () => {
    const before = snap([{ quantity: 2, unitCostCents: 400_000 }]);
    expect(describeBudgetHistory("BUDGET_UPDATED", before, snap([{ quantity: 1, unitCostCents: 500_000 }], "Cortamos a equipe"))).toBe(
      "Orçamento editado: itens (custo de R$ 8.000,00 para R$ 5.000,00), observações."
    );
    expect(describeBudgetHistory("BUDGET_UPDATED", before, snap([{ quantity: 2, unitCostCents: 400_000 }], "nota"))).toBe("Orçamento editado: observações.");
    // Mudou o item mas o custo total é o mesmo: não inventa "de X para X".
    expect(describeBudgetHistory("BUDGET_UPDATED", before, snap([{ quantity: 4, unitCostCents: 200_000 }]))).toBe("Orçamento editado: itens.");
    expect(describeBudgetHistory("BUDGET_UPDATED", before, before)).toBe("Orçamento editado.");
  });

  it("ação desconhecida sai como veio (nunca some)", () => {
    expect(describeBudgetHistory("BUDGET_ALGO_NOVO", null, null)).toBe("BUDGET_ALGO_NOVO");
  });
});
