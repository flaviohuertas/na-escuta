import { describe, expect, it } from "vitest";
import { COMPARISON_STATUS_LABEL, compareToBudget, describeExpenseHistory, formatExpenseDate } from "@/lib/domain/finance";
import { canManageBudget, canManageCrm, canManageFinance } from "@/lib/domain/permissions";

const planned = (category: string, subtotalCents: number) => ({ category, subtotalCents });
const realized = (category: string, totalCents: number) => ({ category, totalCents });

describe("previsto × realizado por categoria", () => {
  it("estourou, coube e gastou sem previsão — cada categoria no seu estado", () => {
    const result = compareToBudget([planned("AV", 600_000), planned("STAFF", 200_000)], [realized("AV", 650_000), realized("FOOD", 30_000)]);

    expect(result.rows).toEqual([
      { category: "AV", hasPlan: true, plannedCents: 600_000, realizedCents: 650_000, varianceCents: 50_000, consumedBps: 10833, status: "OVER" },
      { category: "FOOD", hasPlan: false, plannedCents: 0, realizedCents: 30_000, varianceCents: 30_000, consumedBps: null, status: "UNPLANNED" },
      { category: "STAFF", hasPlan: true, plannedCents: 200_000, realizedCents: 0, varianceCents: -200_000, consumedBps: 0, status: "WITHIN" },
    ]);
  });

  it("os totais somam tudo — inclusive o gasto sem previsão (o dinheiro nunca some)", () => {
    const result = compareToBudget([planned("AV", 600_000), planned("STAFF", 200_000)], [realized("AV", 650_000), realized("FOOD", 30_000)]);

    expect(result).toMatchObject({ hasBudget: true, plannedTotalCents: 800_000, realizedTotalCents: 680_000, varianceTotalCents: -120_000, consumedTotalBps: 8500 });
  });

  it("gastar EXATAMENTE o previsto cabe (não é estouro); um centavo a mais estoura", () => {
    expect(compareToBudget([planned("AV", 1000)], [realized("AV", 1000)]).rows[0]).toMatchObject({ status: "WITHIN", varianceCents: 0, consumedBps: 10000 });
    expect(compareToBudget([planned("AV", 1000)], [realized("AV", 1001)]).rows[0]).toMatchObject({ status: "OVER", varianceCents: 1 });
  });

  it("previsão de zero com gasto estoura, mas sem percentual (não há divisão por zero)", () => {
    const [row] = compareToBudget([planned("AV", 0)], [realized("AV", 500)]).rows;

    expect(row).toMatchObject({ hasPlan: true, plannedCents: 0, status: "OVER", consumedBps: null });
  });

  it("sem orçamento: só o realizado, tudo 'sem previsão', e nenhum percentual", () => {
    const result = compareToBudget([], [realized("AV", 300_000), realized("FOOD", 100_000)]);

    expect(result.hasBudget).toBe(false);
    expect(result.rows.every((row) => row.status === "UNPLANNED" && row.consumedBps === null)).toBe(true);
    expect(result).toMatchObject({ plannedTotalCents: 0, realizedTotalCents: 400_000, consumedTotalBps: null });
  });

  it("sem nada previsto nem lançado: nenhuma linha e totais zerados", () => {
    expect(compareToBudget([], [])).toEqual({ rows: [], hasBudget: false, plannedTotalCents: 0, realizedTotalCents: 0, varianceTotalCents: 0, consumedTotalBps: null });
  });

  it("a ordem é a do orçamento (não a de chegada) e categoria desconhecida vai por último", () => {
    const result = compareToBudget([planned("OTHER", 100)], [realized("FUTURA", 5), realized("STRUCTURE", 7), realized("PERMITS", 9)]);

    expect(result.rows.map((row) => row.category)).toEqual(["STRUCTURE", "PERMITS", "OTHER", "FUTURA"]);
  });

  it("linhas repetidas da mesma categoria se somam (previsto e realizado)", () => {
    const result = compareToBudget([planned("AV", 100), planned("AV", 200)], [realized("AV", 50), realized("AV", 70)]);

    expect(result.rows).toEqual([expect.objectContaining({ category: "AV", plannedCents: 300, realizedCents: 120 })]);
  });

  it("todo estado tem rótulo em português", () => {
    expect(COMPARISON_STATUS_LABEL).toEqual({ OVER: "Estourou", WITHIN: "Dentro do previsto", UNPLANNED: "Sem previsão" });
  });
});

describe("histórico do financeiro em palavras", () => {
  const snap = (overrides: Record<string, unknown> = {}) => ({
    category: "FOOD",
    description: "Buffet",
    supplier: null,
    amountCents: 500_000,
    expenseDate: "2027-01-08",
    notes: null,
    ...overrides,
  });

  it("criado: diz o quê, a categoria e o valor", () => {
    expect(describeExpenseHistory("EXPENSE_CREATED", null, snap())).toBe("Lançamento criado: Buffet (Alimentação e bebidas, R$ 5.000,00).");
  });

  it("editado: diz o que mudou, com o valor de antes e de depois", () => {
    expect(describeExpenseHistory("EXPENSE_UPDATED", snap(), snap({ amountCents: 450_000, notes: "Desconto", supplier: "Buffet Sabor" }))).toBe(
      "Lançamento editado (Buffet): valor (de R$ 5.000,00 para R$ 4.500,00), fornecedor, observações."
    );
    expect(describeExpenseHistory("EXPENSE_UPDATED", snap(), snap({ category: "STAFF", expenseDate: "2027-01-09", description: "Buffet" }))).toBe(
      "Lançamento editado (Buffet): categoria, data."
    );
    expect(describeExpenseHistory("EXPENSE_UPDATED", snap(), snap())).toBe("Lançamento editado (Buffet).");
  });

  it("estornado: diz o valor que saiu dos totais e o motivo", () => {
    expect(describeExpenseHistory("EXPENSE_VOIDED", snap(), snap(), { reason: "Cliente cancelou" })).toBe("Lançamento estornado: Buffet (R$ 5.000,00) — Cliente cancelou.");
    expect(describeExpenseHistory("EXPENSE_VOIDED", snap(), snap(), {})).toBe("Lançamento estornado: Buffet (R$ 5.000,00).");
  });

  it("ação desconhecida sai como veio e dados ausentes não quebram", () => {
    expect(describeExpenseHistory("EXPENSE_ALGO_NOVO", null, null)).toBe("EXPENSE_ALGO_NOVO");
    expect(describeExpenseHistory("EXPENSE_CREATED", null, null)).toBe("Lançamento criado: lançamento.");
  });

  it("a data do lançamento sai como o dia do calendário, sem fuso", () => {
    expect(formatExpenseDate("2027-01-08")).toBe("08/01/2027");
    expect(formatExpenseDate("lixo")).toBe("—");
  });
});

describe("quem vê o financeiro (regra própria, falha fechada)", () => {
  it("só titular e administração — nem a produção, que cuida do comercial", () => {
    for (const role of ["OWNER", "ADMIN"]) expect(canManageFinance(role), role).toBe(true);
    for (const role of ["PRODUCER", "STAFF", "FREELANCER", "VIEWER", "", "owner", "QUALQUER"]) expect(canManageFinance(role), role).toBe(false);
  });

  it("quem vê o financeiro também cuida do comercial (a regra é mais estreita, não paralela)", () => {
    for (const role of ["OWNER", "ADMIN", "PRODUCER", "STAFF", "FREELANCER", "VIEWER"]) {
      if (canManageFinance(role)) expect(canManageCrm(role), role).toBe(true);
    }
    expect(canManageFinance("PRODUCER")).toBe(false);
  });

  it("hoje coincide com a do orçamento — mas são regras separadas, para poderem divergir", () => {
    for (const role of ["OWNER", "ADMIN", "PRODUCER", "STAFF", "FREELANCER", "VIEWER"]) {
      expect(canManageFinance(role), role).toBe(canManageBudget(role));
    }
  });
});
