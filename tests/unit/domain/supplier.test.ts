import { describe, expect, it } from "vitest";
import { describeSupplierHistory, summarizeSpend, supplierSummaryLine } from "@/lib/domain/supplier";
import { canManageBudget, canManageCrm, canManageFinance, canManageSuppliers } from "@/lib/domain/permissions";

describe("quem cuida do cadastro de fornecedores (regra própria, falha fechada)", () => {
  it("titular, administração e produção; ninguém mais", () => {
    for (const role of ["OWNER", "ADMIN", "PRODUCER"]) expect(canManageSuppliers(role), role).toBe(true);
    for (const role of ["STAFF", "FREELANCER", "VIEWER", "", "owner", "QUALQUER"]) expect(canManageSuppliers(role), role).toBe(false);
  });

  it("o dinheiro é MAIS fechado que o cadastro: quem vê o financeiro e o orçamento sempre vê o cadastro, mas a produção só o cadastro", () => {
    for (const role of ["OWNER", "ADMIN", "PRODUCER", "STAFF", "FREELANCER", "VIEWER"]) {
      if (canManageFinance(role)) expect(canManageSuppliers(role), `finance ⊂ suppliers: ${role}`).toBe(true);
      if (canManageBudget(role)) expect(canManageSuppliers(role), `budget ⊂ suppliers: ${role}`).toBe(true);
    }
    expect(canManageSuppliers("PRODUCER")).toBe(true);
    expect(canManageFinance("PRODUCER")).toBe(false);
  });

  it("hoje coincide com a do comercial — mas são regras separadas, para poderem divergir", () => {
    for (const role of ["OWNER", "ADMIN", "PRODUCER", "STAFF", "FREELANCER", "VIEWER"]) {
      expect(canManageSuppliers(role), role).toBe(canManageCrm(role));
    }
  });
});

describe("histórico do fornecedor em palavras", () => {
  const snap = (overrides: Record<string, unknown> = {}) => ({
    name: "Som Alfa",
    kind: "COMPANY",
    document: null,
    contactName: null,
    email: null,
    phone: null,
    category: null,
    notes: null,
    archived: false,
    ...overrides,
  });

  it("criado, arquivado e reativado", () => {
    expect(describeSupplierHistory("SUPPLIER_CREATED", null, snap())).toBe("Fornecedor cadastrado.");
    expect(describeSupplierHistory("SUPPLIER_ARCHIVED", snap(), snap({ archived: true }))).toBe("Fornecedor arquivado.");
    expect(describeSupplierHistory("SUPPLIER_RESTORED", snap({ archived: true }), snap())).toBe("Fornecedor reativado.");
  });

  it("editado: diz O QUE mudou (sem despejar o dado), com a categoria de antes e de depois", () => {
    expect(describeSupplierHistory("SUPPLIER_UPDATED", snap(), snap({ phone: "(31) 3000-0000", email: "a@a.com" }))).toBe("Editado: e-mail, telefone.");
    expect(describeSupplierHistory("SUPPLIER_UPDATED", snap({ category: "AV" }), snap({ category: "FOOD" }))).toBe(
      "Editado: categoria (Som, luz e imagem → Alimentação e bebidas)."
    );
    expect(describeSupplierHistory("SUPPLIER_UPDATED", snap({ category: null }), snap({ category: "AV" }))).toBe("Editado: categoria (— → Som, luz e imagem).");
    expect(describeSupplierHistory("SUPPLIER_UPDATED", snap({ document: null }), snap({ document: "06990590000123" }))).toBe("Editado: documento.");
    expect(describeSupplierHistory("SUPPLIER_UPDATED", snap(), snap())).toBe("Cadastro editado.");
  });

  it("renomear diz de qual nome para qual e em quantos registros o nome foi atualizado (com o plural certo)", () => {
    const renamed = snap({ name: "Som Alfa Ltda" });
    expect(describeSupplierHistory("SUPPLIER_UPDATED", snap(), renamed, { renamedBudgetItems: 2, renamedExpenses: 1 })).toBe(
      "Editado: nome (de Som Alfa para Som Alfa Ltda; atualizado em 2 itens de orçamento e 1 lançamento)."
    );
    expect(describeSupplierHistory("SUPPLIER_UPDATED", snap(), renamed, { renamedBudgetItems: 1, renamedExpenses: 3 })).toBe(
      "Editado: nome (de Som Alfa para Som Alfa Ltda; atualizado em 1 item de orçamento e 3 lançamentos)."
    );
    expect(describeSupplierHistory("SUPPLIER_UPDATED", snap(), renamed, { renamedBudgetItems: 0, renamedExpenses: 0 })).toBe("Editado: nome (de Som Alfa para Som Alfa Ltda).");
    expect(describeSupplierHistory("SUPPLIER_UPDATED", snap(), renamed)).toBe("Editado: nome (de Som Alfa para Som Alfa Ltda).");
  });

  it("ação desconhecida sai como veio (nunca some) e dados ausentes não quebram", () => {
    expect(describeSupplierHistory("SUPPLIER_ALGO_NOVO", null, null)).toBe("SUPPLIER_ALGO_NOVO");
    expect(describeSupplierHistory("SUPPLIER_UPDATED", null, null)).toBe("Cadastro editado.");
  });
});

describe("quanto se gastou e se orçou com um fornecedor", () => {
  const group = (id: string, totalCents: number, count: number) => ({ id, name: id, totalCents, count });

  it("os totais são a SOMA dos grupos (a lista e o total nunca discordam)", () => {
    const summary = summarizeSpend([group("e1", 500_000, 2), group("e2", 50_000, 1)], [group("o1", 610_000, 2)]);

    expect(summary).toEqual({ realizedTotalCents: 550_000, realizedCount: 3, plannedTotalCents: 610_000, plannedCount: 2, overPlanned: false });
  });

  it("avisa quando se gastou MAIS que o orçado com este fornecedor — e só se há orçamento com ele", () => {
    expect(summarizeSpend([group("e1", 100_001, 1)], [group("o1", 100_000, 1)]).overPlanned).toBe(true);
    expect(summarizeSpend([group("e1", 100_000, 1)], [group("o1", 100_000, 1)]).overPlanned).toBe(false); // exatamente o orçado cabe
    expect(summarizeSpend([group("e1", 999_999, 1)], []).overPlanned).toBe(false); // sem orçamento com ele não há o que estourar
  });

  it("sem nada: tudo zero", () => {
    expect(summarizeSpend([], [])).toEqual({ realizedTotalCents: 0, realizedCount: 0, plannedTotalCents: 0, plannedCount: 0, overPlanned: false });
  });
});

describe("linha-resumo de um fornecedor", () => {
  it("tipo, documento formatado e categoria, só o que existe", () => {
    expect(supplierSummaryLine({ kind: "COMPANY", document: "06990590000123", category: "AV" })).toBe("Empresa · 06.990.590/0001-23 · Som, luz e imagem");
    expect(supplierSummaryLine({ kind: "PERSON", document: "52998224725", category: null })).toBe("Pessoa · 529.982.247-25");
    expect(supplierSummaryLine({ kind: "COMPANY", document: null, category: null })).toBe("Empresa");
  });
});
