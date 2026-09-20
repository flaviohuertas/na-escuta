import { describe, expect, it } from "vitest";
import { formatChangeValue, formatDateTimeBR } from "@/lib/domain/approval-format";
import {
  EventChangesSchema,
  ProposeEventChangeSchema,
  ReviewDecisionSchema,
  StoredEventChangeSchema,
} from "@/lib/domain/approval.schema";

const eventId = "01991b1a-0000-7000-8000-0000000000e1";

describe("EventChangesSchema", () => {
  it("aceita só os campos que mudam; o resto não vem", () => {
    expect(EventChangesSchema.parse({ name: "  Novo nome  " })).toEqual({ name: "Novo nome" });
    expect(EventChangesSchema.parse({ location: null, description: null })).toEqual({ location: null, description: null });
  });

  it("recusa proposta VAZIA: precisa de pelo menos um campo", () => {
    expect(EventChangesSchema.safeParse({}).success).toBe(false);
    expect(EventChangesSchema.safeParse({ name: undefined }).success).toBe(false);
  });

  it("recusa qualquer campo que uma proposta NÃO pode mexer (versão, empresa, exclusão…), em vez de ignorá-lo", () => {
    for (const extra of [{ version: 9 }, { companyId: "outra" }, { deletedAt: "2026-01-01T00:00:00.000Z" }, { id: eventId }, { createdBy: "x" }]) {
      expect(EventChangesSchema.safeParse({ name: "Ok", ...extra }).success, JSON.stringify(extra)).toBe(false);
    }
  });

  it("nome não pode ficar vazio nem passar de 200; datas precisam ser ISO; situação, uma das conhecidas", () => {
    expect(EventChangesSchema.safeParse({ name: "   " }).success).toBe(false);
    expect(EventChangesSchema.safeParse({ name: "x".repeat(201) }).success).toBe(false);
    expect(EventChangesSchema.safeParse({ startDate: "amanhã" }).success).toBe(false);
    expect(EventChangesSchema.safeParse({ status: "ARQUIVADO" }).success).toBe(false);
    expect(EventChangesSchema.safeParse({ status: "CANCELLED" }).success).toBe(true);
  });

  it("com as duas datas, o término não pode ser anterior ao início (a mensagem fica no campo do término)", () => {
    const bad = EventChangesSchema.safeParse({ startDate: "2026-12-02T00:00:00.000Z", endDate: "2026-12-01T00:00:00.000Z" });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues[0]).toMatchObject({ path: ["endDate"] });
    expect(EventChangesSchema.safeParse({ startDate: "2026-12-01T00:00:00.000Z", endDate: "2026-12-01T00:00:00.000Z" }).success).toBe(true);
  });
});

describe("ProposeEventChangeSchema", () => {
  it("exige um id de evento válido; o motivo é opcional e vem sem as pontas", () => {
    expect(ProposeEventChangeSchema.parse({ eventId, changes: { name: "X" }, reason: "  porque sim  " }).reason).toBe("porque sim");
    expect(ProposeEventChangeSchema.parse({ eventId, changes: { name: "X" } }).reason).toBeUndefined();
    expect(ProposeEventChangeSchema.safeParse({ eventId: "nao-uuid", changes: { name: "X" } }).success).toBe(false);
    expect(ProposeEventChangeSchema.safeParse({ eventId, changes: { name: "X" }, reason: "x".repeat(1001) }).success).toBe(false);
  });
});

describe("ReviewDecisionSchema", () => {
  it("aprovar não exige observação", () => {
    expect(ReviewDecisionSchema.safeParse({ decision: "APPROVE" }).success).toBe(true);
    expect(ReviewDecisionSchema.safeParse({ decision: "APPROVE", notes: null }).success).toBe(true);
  });

  it("rejeitar EXIGE o motivo (pelo menos 3 caracteres, sem contar espaços das pontas)", () => {
    for (const notes of [undefined, null, "", "   ", "ok", " a "]) {
      const result = ReviewDecisionSchema.safeParse({ decision: "REJECT", notes });
      expect(result.success, String(notes)).toBe(false);
      if (!result.success) expect(result.error.issues[0]).toMatchObject({ path: ["notes"], message: "Explique o motivo da rejeição para quem propôs." });
    }
    expect(ReviewDecisionSchema.safeParse({ decision: "REJECT", notes: "Não confere" }).success).toBe(true);
  });

  it("recusa decisão desconhecida", () => {
    expect(ReviewDecisionSchema.safeParse({ decision: "TALVEZ", notes: "abc" }).success).toBe(false);
    expect(ReviewDecisionSchema.safeParse({ notes: "abc" }).success).toBe(false);
  });
});

describe("StoredEventChangeSchema — o formato guardado no banco", () => {
  it("aceita o que o servidor grava", () => {
    expect(
      StoredEventChangeSchema.safeParse({ baseVersion: 3, before: { name: "A" }, after: { name: "B" }, reason: null }).success
    ).toBe(true);
  });

  it("recusa o que não confere (é o que impede aplicar uma proposta corrompida ou de outra versão)", () => {
    for (const broken of [
      null,
      {},
      { after: { name: "B" } },
      { baseVersion: 0, before: {}, after: {}, reason: null },
      { baseVersion: 1, before: { name: 5 }, after: {}, reason: null },
      { baseVersion: 1, before: {}, after: { versao: "9" }, reason: null },
    ]) {
      expect(StoredEventChangeSchema.safeParse(broken).success, JSON.stringify(broken)).toBe(false);
    }
  });
});

describe("formatChangeValue / formatDateTimeBR", () => {
  it("valor vazio é dito em palavras", () => {
    expect(formatChangeValue("location", null)).toBe("— (sem valor)");
    expect(formatChangeValue("description", "")).toBe("— (sem valor)");
  });

  it("situação vira o rótulo; texto segue como está", () => {
    expect(formatChangeValue("status", "CONFIRMED")).toBe("Confirmado");
    expect(formatChangeValue("status", "DESCONHECIDA")).toBe("DESCONHECIDA");
    expect(formatChangeValue("name", "Festival")).toBe("Festival");
  });

  it("datas saem no horário de Brasília, o mesmo no servidor e no navegador", () => {
    // 12:00Z = 09:00 em Brasília (UTC-3), qualquer que seja o fuso de quem roda o teste.
    expect(formatDateTimeBR("2026-12-01T12:00:00.000Z")).toMatch(/01\/12\/2026.*09:00/);
    expect(formatChangeValue("startDate", "2026-12-01T12:00:00.000Z")).toMatch(/01\/12\/2026.*09:00/);
  });

  it("data inválida não estoura: devolve o texto como veio", () => {
    expect(formatDateTimeBR("não é data")).toBe("não é data");
  });
});
