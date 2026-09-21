import { describe, expect, it } from "vitest";
import { z } from "zod";
import { BudgetItemSchema, BudgetSaveSchema } from "@/lib/domain/budget.schema";

const item = (overrides: Record<string, unknown> = {}) => ({ category: "AV", description: "Sonorização", quantity: 2, unitCostCents: 300_000, supplier: null, ...overrides });
const save = (overrides: Record<string, unknown> = {}) => ({ items: [item()], notes: null, baseVersion: 0, ...overrides });
const fails = (schema: z.ZodType, value: unknown) => {
  const result = schema.safeParse(value);
  if (result.success) throw new Error("esperava falhar");
  return result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
};

describe("item do orçamento", () => {
  it("aceita um item normal, apara os textos e trata fornecedor vazio como null", () => {
    expect(BudgetItemSchema.parse(item({ description: "  Som  ", supplier: "  Alfa  " }))).toEqual({
      category: "AV",
      description: "Som",
      quantity: 2,
      unitCostCents: 300_000,
      supplier: "Alfa",
      supplierId: null,
    });
    expect(BudgetItemSchema.parse(item({ supplier: "   " })).supplier).toBeNull();
    expect(BudgetItemSchema.parse({ category: "AV", description: "Som", quantity: 1, unitCostCents: 0 }).supplier).toBeNull();
  });

  it("a categoria precisa ser uma das conhecidas — vazia ou inventada é recusada", () => {
    for (const bad of ["", "av", "INVENTADA", null]) {
      expect(fails(BudgetItemSchema, item({ category: bad })).join(" "), String(bad)).toMatch(/^category:/);
    }
    expect(fails(BudgetItemSchema, item({ category: "" }))).toContain("category: Escolha a categoria do item.");
  });

  it("recusa descrição curta, quantidade zero/fracionada/enorme e custo quebrado/negativo/acima do teto", () => {
    expect(fails(BudgetItemSchema, item({ description: "A" }))).toContain("description: Descreva o item.");
    expect(fails(BudgetItemSchema, item({ quantity: 0 }))).toContain("quantity: A quantidade mínima é 1.");
    expect(fails(BudgetItemSchema, item({ quantity: 1.5 }))).toContain("quantity: A quantidade precisa ser um número inteiro.");
    expect(fails(BudgetItemSchema, item({ quantity: 100_001 }))).toContain("quantity: A quantidade máxima é 100000.");
    expect(fails(BudgetItemSchema, item({ unitCostCents: 10.5 }))).toContain("unitCostCents: O custo precisa estar em centavos.");
    expect(fails(BudgetItemSchema, item({ unitCostCents: -1 }))).toContain("unitCostCents: O custo não pode ser negativo.");
    expect(fails(BudgetItemSchema, item({ unitCostCents: 2_000_000_001 }))).toContain("unitCostCents: Custo acima do limite de R$ 20 milhões.");
    expect(fails(BudgetItemSchema, item({ supplier: "x".repeat(121) })).join(" ")).toMatch(/^supplier:/);
  });

  it("custo zero é permitido (item já pago ou cortesia)", () => {
    expect(BudgetItemSchema.safeParse(item({ unitCostCents: 0 })).success).toBe(true);
  });
});

describe("salvar o orçamento", () => {
  it("aceita a lista, as premissas e a versão; observações em branco viram null", () => {
    expect(BudgetSaveSchema.parse(save({ notes: "   " })).notes).toBeNull();
    expect(BudgetSaveSchema.parse(save({ notes: "  Montagem em 2 dias  ", baseVersion: 3 }))).toMatchObject({ notes: "Montagem em 2 dias", baseVersion: 3 });
  });

  it("o TOTAL não vem do cliente: campo desconhecido é recusado (422), não ignorado em silêncio", () => {
    for (const extra of [{ totalCents: 1 }, { totalCostCents: 1 }, { version: 2 }, { companyId: "x" }]) {
      expect(fails(BudgetSaveSchema, save(extra)).join(" "), JSON.stringify(extra)).toMatch(/Unrecognized key/i);
    }
    expect(fails(BudgetSaveSchema, save({ items: [{ ...item(), totalCents: 1 }] })).join(" ")).toMatch(/Unrecognized key/i);
  });

  it("a versão é obrigatória; 0 significa 'ainda não existia'; negativa ou fracionada é recusada", () => {
    expect(BudgetSaveSchema.safeParse(save({ baseVersion: 0 })).success).toBe(true);
    const { baseVersion, ...withoutVersion } = save();
    expect(baseVersion).toBe(0);
    expect(fails(BudgetSaveSchema, withoutVersion).join(" ")).toMatch(/baseVersion/);
    expect(fails(BudgetSaveSchema, save({ baseVersion: -1 })).join(" ")).toMatch(/baseVersion/);
    expect(fails(BudgetSaveSchema, save({ baseVersion: 1.5 })).join(" ")).toMatch(/baseVersion/);
  });

  it("exige ao menos um item e no máximo 200", () => {
    expect(fails(BudgetSaveSchema, save({ items: [] }))).toContain("items: Inclua ao menos um item.");
    const many = (n: number) => Array.from({ length: n }, () => item({ quantity: 1, unitCostCents: 1 }));
    expect(fails(BudgetSaveSchema, save({ items: many(201) }))).toContain("items: No máximo 200 itens.");
    expect(BudgetSaveSchema.safeParse(save({ items: many(200) })).success).toBe(true);
  });

  it("um item ou o total acima de R$ 20 milhões é recusado apontando onde", () => {
    expect(fails(BudgetSaveSchema, save({ items: [item({ quantity: 100_000, unitCostCents: 1_000_000 })] })).join(" ")).toMatch(/items\.0\.unitCostCents: O total deste item passa do limite/);
    const big = item({ quantity: 1, unitCostCents: 1_500_000_000 });
    expect(fails(BudgetSaveSchema, save({ items: [big, big] }))).toContain("items: O custo total do orçamento passa do limite de R$ 20 milhões.");
  });

  it("premissas longas demais são recusadas", () => {
    expect(fails(BudgetSaveSchema, save({ notes: "x".repeat(4001) })).join(" ")).toMatch(/^notes:/);
  });
});
