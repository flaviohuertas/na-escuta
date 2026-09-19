import { describe, expect, it } from "vitest";
import { EventInputSchema, EventUpdateInputSchema } from "@/lib/domain/event.schema";

const valid = {
  name: "Festival",
  startDate: "2026-10-01T12:00:00.000Z",
  endDate: "2026-10-02T12:00:00.000Z",
};

describe("EventInputSchema", () => {
  it("aceita o mínimo e assume PLANNED", () => {
    const parsed = EventInputSchema.parse(valid);
    expect(parsed.status).toBe("PLANNED");
  });

  it("nome em branco é recusado, com mensagem clara", () => {
    const result = EventInputSchema.safeParse({ ...valid, name: "   " });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Informe o nome do evento");
  });

  it("término antes do início é recusado no campo do término", () => {
    const result = EventInputSchema.safeParse({ ...valid, endDate: "2026-09-30T12:00:00.000Z" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({
      path: ["endDate"],
      message: "A data de término não pode ser anterior à data de início",
    });
  });

  it("término igual ao início é válido (evento de um instante só)", () => {
    expect(EventInputSchema.safeParse({ ...valid, endDate: valid.startDate }).success).toBe(true);
  });

  it("data vazia dá a mensagem do campo, não 'Invalid ISO datetime'", () => {
    const result = EventInputSchema.safeParse({ ...valid, startDate: "" });
    expect(result.error?.issues[0]?.message).toBe("Informe a data de início");
  });

  it("situação fora da lista é recusada", () => {
    expect(EventInputSchema.safeParse({ ...valid, status: "ARQUIVADO" }).success).toBe(false);
  });
});

describe("EventUpdateInputSchema", () => {
  it("exige a versão que a pessoa estava vendo (controle otimista)", () => {
    expect(EventUpdateInputSchema.safeParse(valid).success).toBe(false);
    expect(EventUpdateInputSchema.safeParse({ ...valid, baseVersion: 0 }).success).toBe(false);
    expect(EventUpdateInputSchema.safeParse({ ...valid, baseVersion: 1.5 }).success).toBe(false);
    expect(EventUpdateInputSchema.safeParse({ ...valid, baseVersion: 3 }).success).toBe(true);
  });

  it("mantém a regra de término depois do início", () => {
    const result = EventUpdateInputSchema.safeParse({
      ...valid,
      baseVersion: 1,
      endDate: "2026-09-30T12:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });
});
