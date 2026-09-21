import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ExpenseInputSchema, ExpenseUpdateSchema, ExpenseVoidSchema } from "@/lib/domain/finance.schema";

const expense = (overrides: Record<string, unknown> = {}) => ({
  category: "AV",
  description: "Sonorização — sinal",
  supplier: null,
  amountCents: 300_000,
  expenseDate: "2027-01-08",
  notes: null,
  ...overrides,
});
const fails = (schema: z.ZodType, value: unknown) => {
  const result = schema.safeParse(value);
  if (result.success) throw new Error("esperava falhar");
  return result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
};

describe("lançar um custo", () => {
  it("aceita um lançamento normal, apara os textos e trata em branco como null", () => {
    expect(ExpenseInputSchema.parse(expense({ description: "  Som  ", supplier: "  Alfa  ", notes: "   " }))).toEqual({
      category: "AV",
      description: "Som",
      supplier: "Alfa",
      supplierId: null,
      amountCents: 300_000,
      expenseDate: "2027-01-08",
      notes: null,
    });
    expect(ExpenseInputSchema.parse({ category: "AV", description: "Som", amountCents: 1, expenseDate: "2027-01-08" })).toMatchObject({ supplier: null, notes: null });
  });

  it("o valor é em centavos e MAIOR QUE ZERO: dinheiro que volta é estorno, não valor negativo", () => {
    expect(fails(ExpenseInputSchema, expense({ amountCents: 0 }))).toContain("amountCents: O valor precisa ser maior que zero.");
    expect(fails(ExpenseInputSchema, expense({ amountCents: -100 }))).toContain("amountCents: O valor precisa ser maior que zero.");
    expect(fails(ExpenseInputSchema, expense({ amountCents: 10.5 }))).toContain("amountCents: O valor precisa estar em centavos.");
    expect(fails(ExpenseInputSchema, expense({ amountCents: 2_000_000_001 }))).toContain("amountCents: Valor acima do limite de R$ 20 milhões.");
    expect(ExpenseInputSchema.safeParse(expense({ amountCents: 1 })).success).toBe(true);
    expect(ExpenseInputSchema.safeParse(expense({ amountCents: 2_000_000_000 })).success).toBe(true);
  });

  it("a categoria precisa ser uma das do orçamento — vazia ou inventada é recusada", () => {
    for (const bad of ["", "av", "INVENTADA", null]) {
      expect(fails(ExpenseInputSchema, expense({ category: bad })).join(" "), String(bad)).toMatch(/^category:/);
    }
    expect(fails(ExpenseInputSchema, expense({ category: "" }))).toContain("category: Escolha a categoria.");
  });

  it("a data é um dia que EXISTE de verdade, sem horário nem fuso", () => {
    for (const bad of ["2027-02-29", "31/01/2027", "2027-01-08T00:00:00Z", "", "ontem"]) {
      expect(fails(ExpenseInputSchema, expense({ expenseDate: bad })), bad).toContain("expenseDate: Data inválida.");
    }
    expect(fails(ExpenseInputSchema, { ...expense(), expenseDate: undefined }).join(" ")).toMatch(/^expenseDate:/);
  });

  it("descrição curta ou longa, fornecedor e observações longos demais são recusados", () => {
    expect(fails(ExpenseInputSchema, expense({ description: "A" }))).toContain("description: Descreva o lançamento.");
    expect(fails(ExpenseInputSchema, expense({ description: "x".repeat(201) }))).toContain("description: Descrição longa demais.");
    expect(fails(ExpenseInputSchema, expense({ supplier: "x".repeat(121) })).join(" ")).toMatch(/^supplier:/);
    expect(fails(ExpenseInputSchema, expense({ notes: "x".repeat(1001) })).join(" ")).toMatch(/^notes:/);
  });

  it("é ESTRITO: campo desconhecido (estornar na criação, escolher a empresa, total pronto) é recusado, não ignorado", () => {
    for (const extra of [{ voidedAt: "2027-01-01T00:00:00Z" }, { voidReason: "x" }, { companyId: "x" }, { eventId: "x" }, { version: 9 }, { totalCents: 1 }]) {
      expect(fails(ExpenseInputSchema, expense(extra)).join(" "), JSON.stringify(extra)).toMatch(/Unrecognized key/i);
    }
  });
});

describe("editar um lançamento", () => {
  it("leva a versão que a pessoa via (positiva) e as mesmas regras de conteúdo", () => {
    expect(ExpenseUpdateSchema.safeParse(expense({ baseVersion: 3 })).success).toBe(true);
    expect(fails(ExpenseUpdateSchema, expense()).join(" ")).toMatch(/baseVersion/);
    expect(fails(ExpenseUpdateSchema, expense({ baseVersion: 0 })).join(" ")).toMatch(/baseVersion/);
    expect(fails(ExpenseUpdateSchema, expense({ baseVersion: 1, amountCents: 0 }))).toContain("amountCents: O valor precisa ser maior que zero.");
  });
});

describe("estornar um lançamento", () => {
  it("exige o motivo (mínimo de 3 caracteres depois de aparar) e a versão", () => {
    expect(ExpenseVoidSchema.parse({ reason: "  Lançado no evento errado  ", baseVersion: 2 })).toEqual({ reason: "Lançado no evento errado", baseVersion: 2 });
    expect(fails(ExpenseVoidSchema, { reason: "ab", baseVersion: 1 })).toContain("reason: Diga por que o lançamento foi estornado.");
    expect(fails(ExpenseVoidSchema, { reason: "   ", baseVersion: 1 })).toContain("reason: Diga por que o lançamento foi estornado.");
    expect(fails(ExpenseVoidSchema, { baseVersion: 1 }).join(" ")).toMatch(/^reason:/);
    expect(fails(ExpenseVoidSchema, { reason: "abc" }).join(" ")).toMatch(/baseVersion/);
    expect(fails(ExpenseVoidSchema, { reason: "x".repeat(501), baseVersion: 1 })).toContain("reason: Motivo longo demais.");
  });

  it("é estrito: nada além do motivo e da versão", () => {
    expect(fails(ExpenseVoidSchema, { reason: "abc", baseVersion: 1, amountCents: 0 }).join(" ")).toMatch(/Unrecognized key/i);
  });
});
