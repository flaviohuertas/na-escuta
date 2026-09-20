import { describe, expect, it } from "vitest";
import {
  buildFieldChanges,
  conflictingFields,
  datesStayValid,
  effectiveChanges,
  eventValue,
  normalizeEventValue,
  sameEventValue,
  type EventLike,
} from "@/lib/domain/approval";

const event: EventLike = {
  name: "Festival do Parque",
  description: null,
  location: "Parque",
  startDate: new Date("2026-12-01T12:00:00.000Z"),
  endDate: new Date("2026-12-02T12:00:00.000Z"),
  status: "PLANNED",
};

describe("eventValue / sameEventValue", () => {
  it("datas viram ISO; texto e null seguem como estão", () => {
    expect(eventValue(event, "startDate")).toBe("2026-12-01T12:00:00.000Z");
    expect(eventValue(event, "name")).toBe("Festival do Parque");
    expect(eventValue(event, "description")).toBeNull();
    expect(eventValue({ ...event, startDate: "2026-12-01T12:00:00.000Z" }, "startDate")).toBe("2026-12-01T12:00:00.000Z");
  });

  it("datas comparam o INSTANTE: com ou sem milissegundos, no mesmo ou em outro formato de fuso, é o mesmo valor", () => {
    expect(sameEventValue("startDate", "2026-12-01T12:00:00.000Z", "2026-12-01T12:00:00Z")).toBe(true);
    expect(sameEventValue("startDate", "2026-12-01T12:00:00.000Z", "2026-12-01T09:00:00-03:00")).toBe(true);
    expect(sameEventValue("startDate", "2026-12-01T12:00:00.000Z", "2026-12-01T12:00:01.000Z")).toBe(false);
  });

  it("texto compara o texto (maiúsculas contam); null só é igual a null/undefined", () => {
    expect(sameEventValue("name", "Festa", "Festa")).toBe(true);
    expect(sameEventValue("name", "Festa", "festa")).toBe(false);
    expect(sameEventValue("location", null, undefined)).toBe(true);
    expect(sameEventValue("location", null, "")).toBe(false);
    expect(sameEventValue("location", "Parque", null)).toBe(false);
  });
});

describe("normalizeEventValue — como o servidor grava", () => {
  it("texto opcional em branco vira null; com texto, sem as pontas", () => {
    expect(normalizeEventValue("description", "   ")).toBeNull();
    expect(normalizeEventValue("location", "")).toBeNull();
    expect(normalizeEventValue("location", null)).toBeNull();
    expect(normalizeEventValue("description", "  texto  ")).toBe("texto");
  });

  it("datas viram ISO canônico; nome e situação só perdem as pontas", () => {
    expect(normalizeEventValue("startDate", "2026-12-01T09:00:00-03:00")).toBe("2026-12-01T12:00:00.000Z");
    expect(normalizeEventValue("name", "  Nome  ")).toBe("Nome");
    expect(normalizeEventValue("status", "CONFIRMED")).toBe("CONFIRMED");
  });
});

describe("effectiveChanges — só o que REALMENTE muda", () => {
  it("descarta o campo que já é igual e mantém o que difere", () => {
    expect(effectiveChanges(event, { name: "Festival do Parque", status: "CONFIRMED", location: "Parque" })).toEqual({ status: "CONFIRMED" });
  });

  it("a mesma data em outro formato não é mudança", () => {
    expect(effectiveChanges(event, { startDate: "2026-12-01T09:00:00-03:00" })).toEqual({});
  });

  it("esvaziar um campo que tem valor é mudança (vira null); esvaziar o que já está vazio, não", () => {
    expect(effectiveChanges(event, { location: "  ", description: null })).toEqual({ location: null });
  });

  it("ignora chave ausente ou undefined e devolve vazio quando nada muda", () => {
    expect(effectiveChanges(event, { name: undefined })).toEqual({});
    expect(effectiveChanges(event, {})).toEqual({});
  });

  it("a ordem das chaves da resposta segue a dos campos do evento, não a do que foi enviado", () => {
    expect(Object.keys(effectiveChanges(event, { status: "CONFIRMED", name: "Outro" }))).toEqual(["name", "status"]);
  });
});

describe("conflictingFields — o evento mudou depois da proposta?", () => {
  it("só os campos da proposta que hoje têm outro valor", () => {
    const before = { name: "Festival do Parque", location: "Praça" };
    expect(conflictingFields(before, event)).toEqual(["location"]);
  });

  it("nenhum conflito quando o evento segue como a pessoa o via — mesmo que OUTROS campos tenham mudado", () => {
    const changedElsewhere = { ...event, status: "CONFIRMED" };
    expect(conflictingFields({ name: "Festival do Parque" }, changedElsewhere)).toEqual([]);
  });

  it("campo fora da proposta nunca conflita", () => {
    expect(conflictingFields({}, { ...event, name: "Qualquer coisa" })).toEqual([]);
  });

  it("datas comparam o instante", () => {
    expect(conflictingFields({ startDate: "2026-12-01T09:00:00-03:00" }, event)).toEqual([]);
    expect(conflictingFields({ startDate: "2026-12-01T10:00:00-03:00" }, event)).toEqual(["startDate"]);
  });
});

describe("datesStayValid — o término nunca fica antes do início", () => {
  it("com as duas datas propostas, compara entre elas", () => {
    expect(datesStayValid(event, { startDate: "2026-12-05T00:00:00.000Z", endDate: "2026-12-06T00:00:00.000Z" })).toBe(true);
    expect(datesStayValid(event, { startDate: "2026-12-07T00:00:00.000Z", endDate: "2026-12-06T00:00:00.000Z" })).toBe(false);
  });

  it("com só uma, compara com a outra do evento", () => {
    expect(datesStayValid(event, { startDate: "2026-12-03T00:00:00.000Z" })).toBe(false); // início depois do término de hoje
    expect(datesStayValid(event, { endDate: "2026-11-30T00:00:00.000Z" })).toBe(false);
    expect(datesStayValid(event, { endDate: "2026-12-10T00:00:00.000Z" })).toBe(true);
  });

  it("término igual ao início vale; sem datas na proposta, o evento como está vale", () => {
    expect(datesStayValid(event, { endDate: "2026-12-01T12:00:00.000Z" })).toBe(true);
    expect(datesStayValid(event, { name: "X" })).toBe(true);
  });
});

describe("buildFieldChanges — as linhas 'antes → proposto' contra o evento de agora", () => {
  it("cada campo da proposta vira uma linha com o valor de agora e se houve conflito", () => {
    const rows = buildFieldChanges(
      { before: { name: "Festival do Parque", location: "Praça" }, after: { name: "Festival 2026", location: "Rua" } },
      event
    );

    expect(rows).toEqual([
      { field: "name", label: "Nome", before: "Festival do Parque", current: "Festival do Parque", proposed: "Festival 2026", conflict: false },
      { field: "location", label: "Local", before: "Praça", current: "Parque", proposed: "Rua", conflict: true },
    ]);
  });

  it("só monta linha para o que a proposta traz em `after`", () => {
    expect(buildFieldChanges({ before: { name: "x", status: "PLANNED" }, after: { status: "CONFIRMED" } }, event).map((r) => r.field)).toEqual(["status"]);
  });
});
