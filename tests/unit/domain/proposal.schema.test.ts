import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ProposalActionSchema, ProposalInputSchema, ProposalItemSchema, ProposalUpdateSchema } from "@/lib/domain/proposal.schema";

const item = (overrides: Record<string, unknown> = {}) => ({ description: "Som e iluminação", quantity: 2, unitPriceCents: 500_000, ...overrides });
const input = (overrides: Record<string, unknown> = {}) => ({ items: [item()], discountCents: 0, validUntil: "2027-01-31", notes: null, ...overrides });
const messages = (result: { success: false; error: z.ZodError }) => result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
const fails = (schema: z.ZodType, value: unknown) => {
  const result = schema.safeParse(value);
  if (result.success) throw new Error("esperava falhar");
  return messages(result);
};

describe("item da proposta", () => {
  it("aceita um item normal e apara a descrição", () => {
    expect(ProposalItemSchema.parse(item({ description: "  Palco  " }))).toEqual({ description: "Palco", quantity: 2, unitPriceCents: 500_000 });
  });

  it("recusa descrição curta, quantidade zero/fracionada/enorme e preço quebrado/negativo/acima do teto", () => {
    expect(fails(ProposalItemSchema, item({ description: "A" }))).toContain("description: Descreva o item.");
    expect(fails(ProposalItemSchema, item({ quantity: 0 }))).toContain("quantity: A quantidade mínima é 1.");
    expect(fails(ProposalItemSchema, item({ quantity: 1.5 }))).toContain("quantity: A quantidade precisa ser um número inteiro.");
    expect(fails(ProposalItemSchema, item({ quantity: 100_001 }))).toContain("quantity: A quantidade máxima é 100000.");
    expect(fails(ProposalItemSchema, item({ unitPriceCents: 10.5 }))).toContain("unitPriceCents: O preço precisa estar em centavos.");
    expect(fails(ProposalItemSchema, item({ unitPriceCents: -1 }))).toContain("unitPriceCents: O preço não pode ser negativo.");
    expect(fails(ProposalItemSchema, item({ unitPriceCents: 2_000_000_001 }))).toContain("unitPriceCents: Preço acima do limite de R$ 20 milhões.");
  });

  it("preço zero é permitido (item de cortesia)", () => {
    expect(ProposalItemSchema.safeParse(item({ unitPriceCents: 0 })).success).toBe(true);
  });
});

describe("criar uma proposta", () => {
  it("aceita o conteúdo completo; o que faltou vira o padrão (desconto 0, sem observações, sem origem)", () => {
    expect(ProposalInputSchema.parse({ items: [item()] })).toEqual({
      items: [item()],
      discountCents: 0,
      validUntil: null,
      notes: null,
      copiedFromProposalId: null,
    });
  });

  it("os TOTAIS não vêm do cliente: campo desconhecido é recusado (422), não ignorado em silêncio", () => {
    for (const extra of [{ totalCents: 1 }, { subtotalCents: 1 }, { status: "ACCEPTED" }, { number: 9 }, { version: 3 }]) {
      const problems = fails(ProposalInputSchema, input(extra));
      expect(problems.join(" "), JSON.stringify(extra)).toMatch(/Unrecognized key/i);
    }
    expect(fails(ProposalInputSchema, input({ items: [{ ...item(), totalCents: 1 }] })).join(" ")).toMatch(/Unrecognized key/i);
  });

  it("exige ao menos um item e no máximo 100", () => {
    expect(fails(ProposalInputSchema, input({ items: [] }))).toContain("items: Inclua ao menos um item.");
    expect(fails(ProposalInputSchema, input({ items: Array.from({ length: 101 }, () => item({ quantity: 1, unitPriceCents: 1 })) }))).toContain("items: No máximo 100 itens.");
    expect(ProposalInputSchema.safeParse(input({ items: Array.from({ length: 100 }, () => item({ quantity: 1, unitPriceCents: 1 })) })).success).toBe(true);
  });

  it("desconto: em centavos, sem negativo, sem passar do subtotal", () => {
    expect(fails(ProposalInputSchema, input({ discountCents: -1 }))).toContain("discountCents: O desconto não pode ser negativo.");
    expect(fails(ProposalInputSchema, input({ discountCents: 0.5 }))).toContain("discountCents: O desconto precisa estar em centavos.");
    expect(fails(ProposalInputSchema, input({ discountCents: 1_000_001 }))).toContain("discountCents: O desconto não pode ser maior que o subtotal.");
    expect(ProposalInputSchema.safeParse(input({ discountCents: 1_000_000 })).success).toBe(true);
  });

  it("um item ou o subtotal acima de R$ 20 milhões é recusado apontando onde", () => {
    expect(fails(ProposalInputSchema, input({ items: [item({ quantity: 100_000, unitPriceCents: 1_000_000 })] })).join(" ")).toMatch(/items\.0\.unitPriceCents: O total deste item passa do limite/);
    const big = item({ quantity: 1, unitPriceCents: 1_500_000_000 });
    expect(fails(ProposalInputSchema, input({ items: [big, big] }))).toContain("items: O subtotal da proposta passa do limite de R$ 20 milhões.");
  });

  it("validade: só um dia que existe; vazia vira null; pode faltar no rascunho", () => {
    expect(ProposalInputSchema.parse(input({ validUntil: undefined })).validUntil).toBeNull();
    expect(ProposalInputSchema.parse(input({ validUntil: null })).validUntil).toBeNull();
    for (const bad of ["2027-02-29", "31/01/2027", "2027-01-31T00:00:00Z", ""]) {
      expect(fails(ProposalInputSchema, input({ validUntil: bad })), bad).toContain("validUntil: Data inválida.");
    }
  });

  it("observações em branco viram null e têm limite; a origem precisa ser um id", () => {
    expect(ProposalInputSchema.parse(input({ notes: "   " })).notes).toBeNull();
    expect(ProposalInputSchema.parse(input({ notes: "  Pagamento em 3x  " })).notes).toBe("Pagamento em 3x");
    expect(fails(ProposalInputSchema, input({ notes: "x".repeat(4001) })).join(" ")).toMatch(/^notes:/);
    expect(fails(ProposalInputSchema, input({ copiedFromProposalId: "não-é-uuid" })).join(" ")).toMatch(/^copiedFromProposalId:/);
    expect(ProposalInputSchema.safeParse(input({ copiedFromProposalId: "0f8fad5b-d9cb-469f-a165-70867728950e" })).success).toBe(true);
  });
});

describe("editar o rascunho", () => {
  it("leva a versão que a pessoa via (positiva) e as mesmas regras de conteúdo", () => {
    expect(ProposalUpdateSchema.safeParse(input({ baseVersion: 3 })).success).toBe(true);
    expect(fails(ProposalUpdateSchema, input())).toEqual(expect.arrayContaining([expect.stringMatching(/^baseVersion:/)]));
    expect(fails(ProposalUpdateSchema, input({ baseVersion: 0 }))).toEqual(expect.arrayContaining([expect.stringMatching(/^baseVersion:/)]));
    expect(fails(ProposalUpdateSchema, input({ baseVersion: 1, discountCents: 9_999_999 }))).toContain("discountCents: O desconto não pode ser maior que o subtotal.");
  });

  it("não aceita a origem da cópia (isso é só de criar)", () => {
    expect(fails(ProposalUpdateSchema, input({ baseVersion: 1, copiedFromProposalId: null })).join(" ")).toMatch(/Unrecognized key/i);
  });
});

describe("mudar a situação", () => {
  it("aceita as quatro ações com a versão; a observação em branco vira null", () => {
    for (const action of ["SEND", "ACCEPT", "REJECT", "DISCARD"]) {
      expect(ProposalActionSchema.parse({ action, baseVersion: 2, note: "  " }), action).toEqual({ action, baseVersion: 2, note: null });
    }
    expect(ProposalActionSchema.parse({ action: "ACCEPT", baseVersion: 1, note: " Por telefone " }).note).toBe("Por telefone");
  });

  it("recusa ação desconhecida (inclusive EDIT, que é outra rota), versão inválida e campos a mais", () => {
    expect(fails(ProposalActionSchema, { action: "EDIT", baseVersion: 1 }).join(" ")).toMatch(/^action:/);
    expect(fails(ProposalActionSchema, { action: "SEND" }).join(" ")).toMatch(/baseVersion/);
    expect(fails(ProposalActionSchema, { action: "SEND", baseVersion: 0 }).join(" ")).toMatch(/baseVersion/);
    expect(fails(ProposalActionSchema, { action: "SEND", baseVersion: 1, status: "ACCEPTED" }).join(" ")).toMatch(/Unrecognized key/i);
    expect(fails(ProposalActionSchema, { action: "REJECT", baseVersion: 1, note: "x".repeat(501) }).join(" ")).toMatch(/^note:/);
  });
});
