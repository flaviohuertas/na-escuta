import { describe, expect, it } from "vitest";
import { z } from "zod";
import { BudgetItemSchema } from "@/lib/domain/budget.schema";
import { ExpenseInputSchema } from "@/lib/domain/finance.schema";
import { SupplierArchiveSchema, SupplierInputSchema, SupplierLinkSchema, SupplierUpdateSchema } from "@/lib/domain/supplier.schema";

const SUPPLIER_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const supplier = (overrides: Record<string, unknown> = {}) => ({
  name: "Som Alfa",
  kind: "COMPANY",
  document: null,
  contactName: null,
  email: null,
  phone: null,
  category: null,
  notes: null,
  ...overrides,
});
const fails = (schema: z.ZodType, value: unknown) => {
  const result = schema.safeParse(value);
  if (result.success) throw new Error("esperava falhar");
  return result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
};

describe("cadastrar um fornecedor", () => {
  it("aceita um cadastro completo, apara os textos e trata em branco como null", () => {
    expect(SupplierInputSchema.parse(supplier({ name: "  Buffet Sabor  ", contactName: "  Dona Maria ", email: " vendas@sabor.com ", phone: "  ", notes: "" }))).toEqual({
      name: "Buffet Sabor",
      kind: "COMPANY",
      document: null,
      contactName: "Dona Maria",
      email: "vendas@sabor.com",
      phone: null,
      category: null,
      notes: null,
    });
    expect(SupplierInputSchema.parse({ name: "Só o nome" })).toMatchObject({ kind: "COMPANY", document: null, category: null });
  });

  it("o documento (CPF/CNPJ) vem com ou sem máscara e vira só dígitos — e precisa ter os dígitos verificadores certos", () => {
    expect(SupplierInputSchema.parse(supplier({ document: "06.990.590/0001-23" })).document).toBe("06990590000123");
    expect(SupplierInputSchema.parse(supplier({ document: "529.982.247-25" })).document).toBe("52998224725");
    for (const bad of ["06.990.590/0001-24", "111.111.111-11", "123", "abc"]) {
      expect(fails(SupplierInputSchema, supplier({ document: bad })), bad).toContain("document: CPF ou CNPJ inválido.");
    }
  });

  it("nome curto ou longo, tipo desconhecido e e-mail inválido são recusados", () => {
    expect(fails(SupplierInputSchema, supplier({ name: "A" }))).toContain("name: Informe o nome do fornecedor.");
    expect(fails(SupplierInputSchema, supplier({ name: "x".repeat(201) }))).toContain("name: Nome longo demais.");
    expect(fails(SupplierInputSchema, supplier({ kind: "GOVERNO" })).join(" ")).toMatch(/^kind:/);
    expect(fails(SupplierInputSchema, supplier({ email: "isso-nao-e-email" })).join(" ")).toMatch(/^email:/);
    expect(fails(SupplierInputSchema, supplier({ contactName: "x".repeat(121) })).join(" ")).toMatch(/^contactName:/);
    expect(fails(SupplierInputSchema, supplier({ notes: "x".repeat(2001) })).join(" ")).toMatch(/^notes:/);
  });

  it("a categoria precisa ser uma das do orçamento; vazia (null) é 'sem categoria'", () => {
    expect(SupplierInputSchema.parse(supplier({ category: "AV" })).category).toBe("AV");
    expect(SupplierInputSchema.parse(supplier({ category: null })).category).toBeNull();
    expect(SupplierInputSchema.parse(supplier({ category: undefined })).category).toBeNull();
    for (const bad of ["", "av", "INVENTADA"]) {
      expect(fails(SupplierInputSchema, supplier({ category: bad })), bad).toContain("category: Escolha uma das categorias da lista.");
    }
  });

  it("é ESTRITO: campo desconhecido (arquivar na criação, escolher a empresa) é recusado, não ignorado", () => {
    for (const extra of [{ archivedAt: "2027-01-01T00:00:00Z" }, { companyId: "x" }, { version: 9 }, { archived: true }]) {
      expect(fails(SupplierInputSchema, supplier(extra)).join(" "), JSON.stringify(extra)).toMatch(/Unrecognized key/i);
    }
  });
});

describe("editar e arquivar", () => {
  it("editar leva a versão que a pessoa via (positiva) e as mesmas regras de conteúdo", () => {
    expect(SupplierUpdateSchema.safeParse(supplier({ baseVersion: 3 })).success).toBe(true);
    expect(fails(SupplierUpdateSchema, supplier()).join(" ")).toMatch(/baseVersion/);
    expect(fails(SupplierUpdateSchema, supplier({ baseVersion: 0 })).join(" ")).toMatch(/baseVersion/);
    expect(fails(SupplierUpdateSchema, supplier({ baseVersion: 1, document: "123" }))).toContain("document: CPF ou CNPJ inválido.");
  });

  it("arquivar/reativar: só 'archived' e a versão", () => {
    expect(SupplierArchiveSchema.parse({ archived: true, baseVersion: 2 })).toEqual({ archived: true, baseVersion: 2 });
    expect(fails(SupplierArchiveSchema, { archived: "sim", baseVersion: 1 }).join(" ")).toMatch(/^archived:/);
    expect(fails(SupplierArchiveSchema, { archived: true }).join(" ")).toMatch(/baseVersion/);
    expect(fails(SupplierArchiveSchema, { archived: true, baseVersion: 1, name: "x" }).join(" ")).toMatch(/Unrecognized key/i);
  });
});

describe("o vínculo de um item com o cadastro", () => {
  it("é o id do fornecedor ou null; ausente e null viram null; texto que não é id é recusado", () => {
    expect(SupplierLinkSchema.parse(SUPPLIER_ID)).toBe(SUPPLIER_ID);
    expect(SupplierLinkSchema.parse(null)).toBeNull();
    expect(SupplierLinkSchema.parse(undefined)).toBeNull();
    expect(fails(SupplierLinkSchema, "Som Alfa")).toContain(": Fornecedor inválido.");
    expect(fails(SupplierLinkSchema, "")).toContain(": Fornecedor inválido.");
  });

  it("o item de orçamento e o lançamento aceitam o vínculo (e o padrão é sem vínculo)", () => {
    const item = { category: "AV", description: "Som", quantity: 1, unitCostCents: 100, supplier: null };
    expect(BudgetItemSchema.parse({ ...item, supplierId: SUPPLIER_ID }).supplierId).toBe(SUPPLIER_ID);
    expect(BudgetItemSchema.parse(item).supplierId).toBeNull();
    expect(fails(BudgetItemSchema, { ...item, supplierId: "não-é-id" }).join(" ")).toMatch(/^supplierId:/);

    const expense = { category: "AV", description: "Som", supplier: null, amountCents: 100, expenseDate: "2027-01-08", notes: null };
    expect(ExpenseInputSchema.parse({ ...expense, supplierId: SUPPLIER_ID }).supplierId).toBe(SUPPLIER_ID);
    expect(ExpenseInputSchema.parse(expense).supplierId).toBeNull();
    expect(fails(ExpenseInputSchema, { ...expense, supplierId: "não-é-id" }).join(" ")).toMatch(/^supplierId:/);
  });
});
