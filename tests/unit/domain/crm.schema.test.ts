import { describe, expect, it } from "vitest";
import {
  ClientArchiveSchema,
  ClientInputSchema,
  ClientUpdateSchema,
  ConvertToEventSchema,
  OpportunityInputSchema,
  OpportunityUpdateSchema,
  StageMoveSchema,
} from "@/lib/domain/crm.schema";
import { canManageCrm } from "@/lib/domain/permissions";

const clientId = "01991b1a-0000-7000-8000-0000000000c1";
const userId = "01991b1a-0000-7000-8000-0000000000a1";

describe("ClientInputSchema", () => {
  it("normaliza: documento só com dígitos, e-mail minúsculo, texto opcional em branco vira null", () => {
    const parsed = ClientInputSchema.parse({ name: "  Som e Luz  ", document: "11.222.333/0001-81", email: "  Contato@SomeLuz.com.BR ", phone: "   ", notes: "" });

    expect(parsed).toEqual({ name: "Som e Luz", kind: "COMPANY", document: "11222333000181", email: "contato@someluz.com.br", phone: null, notes: null });
  });

  it("só o nome é obrigatório; o resto pode vir vazio ou ausente", () => {
    expect(ClientInputSchema.parse({ name: "Ana" })).toEqual({ name: "Ana", kind: "COMPANY", document: null, email: null, phone: null, notes: null });
    expect(ClientInputSchema.safeParse({ name: "A" }).success).toBe(false);
    expect(ClientInputSchema.safeParse({}).success).toBe(false);
    expect(ClientInputSchema.safeParse({ name: "x".repeat(201) }).success).toBe(false);
  });

  it("documento digitado errado NÃO entra (senão o mesmo cliente 'duplica' com o número certo)", () => {
    const bad = ClientInputSchema.safeParse({ name: "Ana", document: "529.982.247-26" });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues[0]).toMatchObject({ message: "CPF ou CNPJ inválido.", path: ["document"] });
    expect(ClientInputSchema.safeParse({ name: "Ana", document: "123" }).success).toBe(false);
    expect(ClientInputSchema.parse({ name: "Ana", document: "529.982.247-25" }).document).toBe("52998224725");
  });

  it("e-mail inválido é recusado; e-mail em branco não", () => {
    expect(ClientInputSchema.safeParse({ name: "Ana", email: "isso-nao-e-email" }).success).toBe(false);
    expect(ClientInputSchema.parse({ name: "Ana", email: "" }).email).toBeNull();
    expect(ClientInputSchema.parse({ name: "Ana", email: null }).email).toBeNull();
  });

  it("o tipo é empresa ou pessoa", () => {
    expect(ClientInputSchema.parse({ name: "Ana", kind: "PERSON" }).kind).toBe("PERSON");
    expect(ClientInputSchema.safeParse({ name: "Ana", kind: "GOVERNO" }).success).toBe(false);
  });

  it("limites de tamanho de telefone e observações", () => {
    expect(ClientInputSchema.safeParse({ name: "Ana", phone: "1".repeat(41) }).success).toBe(false);
    expect(ClientInputSchema.safeParse({ name: "Ana", notes: "x".repeat(2001) }).success).toBe(false);
  });
});

describe("ClientUpdateSchema / ClientArchiveSchema", () => {
  it("editar exige a versão que a pessoa via", () => {
    expect(ClientUpdateSchema.safeParse({ name: "Ana" }).success).toBe(false);
    expect(ClientUpdateSchema.safeParse({ name: "Ana", baseVersion: 0 }).success).toBe(false);
    expect(ClientUpdateSchema.parse({ name: "Ana", baseVersion: 3 }).baseVersion).toBe(3);
  });

  it("arquivar exige o booleano e a versão", () => {
    expect(ClientArchiveSchema.safeParse({ archived: true, baseVersion: 1 }).success).toBe(true);
    expect(ClientArchiveSchema.safeParse({ archived: "sim", baseVersion: 1 }).success).toBe(false);
    expect(ClientArchiveSchema.safeParse({ archived: true }).success).toBe(false);
  });
});

describe("OpportunityInputSchema", () => {
  const valid = { clientId, title: "Festival de Verão" };

  it("aceita o mínimo (cliente e título) e devolve o resto como null", () => {
    expect(OpportunityInputSchema.parse(valid)).toEqual({
      clientId,
      title: "Festival de Verão",
      description: null,
      expectedValueCents: null,
      expectedStartDate: null,
      expectedEndDate: null,
      ownerUserId: null,
    });
  });

  it("o cliente precisa ser um id; o título, ter texto", () => {
    expect(OpportunityInputSchema.safeParse({ ...valid, clientId: "nao-uuid" }).success).toBe(false);
    expect(OpportunityInputSchema.safeParse({ ...valid, title: " " }).success).toBe(false);
    expect(OpportunityInputSchema.safeParse({ ...valid, title: "x".repeat(201) }).success).toBe(false);
  });

  it("o valor é em centavos INTEIROS, sem negativo e com teto de R$ 20 milhões", () => {
    expect(OpportunityInputSchema.parse({ ...valid, expectedValueCents: 1_500_000 }).expectedValueCents).toBe(1_500_000);
    expect(OpportunityInputSchema.parse({ ...valid, expectedValueCents: 0 }).expectedValueCents).toBe(0);
    for (const bad of [-1, 10.5, 2_000_000_001, Number.NaN, "100"]) {
      expect(OpportunityInputSchema.safeParse({ ...valid, expectedValueCents: bad }).success, String(bad)).toBe(false);
    }
    expect(OpportunityInputSchema.parse({ ...valid, expectedValueCents: 2_000_000_000 }).expectedValueCents).toBe(2_000_000_000);
  });

  it("o término previsto não pode ser anterior ao início (a mensagem fica no campo do término)", () => {
    const bad = OpportunityInputSchema.safeParse({ ...valid, expectedStartDate: "2027-01-10T00:00:00.000Z", expectedEndDate: "2027-01-09T00:00:00.000Z" });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues[0]).toMatchObject({ path: ["expectedEndDate"] });
    expect(OpportunityInputSchema.safeParse({ ...valid, expectedStartDate: "2027-01-10T00:00:00.000Z", expectedEndDate: "2027-01-10T00:00:00.000Z" }).success).toBe(true);
    // Só uma das duas datas: nada a comparar.
    expect(OpportunityInputSchema.safeParse({ ...valid, expectedEndDate: "2027-01-09T00:00:00.000Z" }).success).toBe(true);
  });

  it("datas precisam ser ISO; o responsável, um id", () => {
    expect(OpportunityInputSchema.safeParse({ ...valid, expectedStartDate: "amanhã" }).success).toBe(false);
    expect(OpportunityInputSchema.safeParse({ ...valid, ownerUserId: "fulano" }).success).toBe(false);
    expect(OpportunityInputSchema.parse({ ...valid, ownerUserId: userId }).ownerUserId).toBe(userId);
  });

  it("atualizar exige a versão", () => {
    expect(OpportunityUpdateSchema.safeParse(valid).success).toBe(false);
    expect(OpportunityUpdateSchema.parse({ ...valid, baseVersion: 2 }).baseVersion).toBe(2);
  });
});

describe("StageMoveSchema", () => {
  it("mover exige a etapa e a versão", () => {
    expect(StageMoveSchema.safeParse({ stage: "CONTACTED", baseVersion: 1 }).success).toBe(true);
    expect(StageMoveSchema.safeParse({ stage: "CONTACTED" }).success).toBe(false);
    expect(StageMoveSchema.safeParse({ stage: "ARQUIVADA", baseVersion: 1 }).success).toBe(false);
  });

  it("PERDER exige o motivo (pelo menos 3 caracteres); as outras etapas não", () => {
    for (const lostReason of [undefined, null, "", "  ", "ab"]) {
      const result = StageMoveSchema.safeParse({ stage: "LOST", lostReason, baseVersion: 1 });
      expect(result.success, String(lostReason)).toBe(false);
      if (!result.success) expect(result.error.issues[0]).toMatchObject({ path: ["lostReason"], message: "Diga por que a oportunidade foi perdida." });
    }
    expect(StageMoveSchema.parse({ stage: "LOST", lostReason: "  Preço alto  ", baseVersion: 1 }).lostReason).toBe("Preço alto");
    expect(StageMoveSchema.safeParse({ stage: "WON", baseVersion: 1 }).success).toBe(true);
  });
});

describe("ConvertToEventSchema", () => {
  const event = { name: "Festival de Verão 2027", startDate: "2027-01-10T12:00:00.000Z", endDate: "2027-01-12T12:00:00.000Z" };

  it("os dados do evento passam pelo MESMO schema do cadastro de evento", () => {
    expect(ConvertToEventSchema.safeParse({ event, baseVersion: 1 }).success).toBe(true);
    expect(ConvertToEventSchema.safeParse({ event: { ...event, name: " " }, baseVersion: 1 }).success).toBe(false);
    expect(ConvertToEventSchema.safeParse({ event: { ...event, endDate: "2027-01-01T00:00:00.000Z" }, baseVersion: 1 }).success).toBe(false);
    expect(ConvertToEventSchema.safeParse({ event: { ...event, startDate: "" }, baseVersion: 1 }).success).toBe(false);
  });

  it("exige a versão da oportunidade que a pessoa via", () => {
    expect(ConvertToEventSchema.safeParse({ event }).success).toBe(false);
  });
});

describe("canManageCrm", () => {
  it("titular, administração e produção; equipe, freelancer e visualização não", () => {
    for (const role of ["OWNER", "ADMIN", "PRODUCER"]) expect(canManageCrm(role), role).toBe(true);
    for (const role of ["STAFF", "FREELANCER", "VIEWER"]) expect(canManageCrm(role), role).toBe(false);
  });

  it("papel desconhecido ou vazio NUNCA pode — falha fechado", () => {
    for (const role of ["", "owner", "SUPERUSER", "producer", "MANAGER"]) expect(canManageCrm(role), role).toBe(false);
  });
});
