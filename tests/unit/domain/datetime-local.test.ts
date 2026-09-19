import { describe, expect, it } from "vitest";
import { isoToLocalInput, localInputToIso } from "@/lib/domain/datetime-local";

describe("datetime-local ↔ ISO", () => {
  it("o que a pessoa digita é o que ela vê depois, em qualquer fuso (ida e volta, no minuto)", () => {
    for (const typed of ["2026-09-19T14:30", "2026-01-01T00:00", "2026-12-31T23:59", "2026-06-15T12:00"]) {
      const iso = localInputToIso(typed);
      expect(iso).not.toBeNull();
      expect(isoToLocalInput(iso!)).toBe(typed);
    }
  });

  it("gera ISO com fuso (Z), como o servidor exige", () => {
    expect(localInputToIso("2026-09-19T14:30")).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/);
  });

  it("interpreta o texto como horário LOCAL: bate com o `new Date(...)` do próprio aparelho", () => {
    expect(localInputToIso("2026-09-19T14:30")).toBe(new Date(2026, 8, 19, 14, 30).toISOString());
  });

  it("vazio ou inválido não vira data: devolve null / string vazia", () => {
    expect(localInputToIso("")).toBeNull();
    expect(localInputToIso("não é data")).toBeNull();
    expect(isoToLocalInput("não é data")).toBe("");
  });
});
