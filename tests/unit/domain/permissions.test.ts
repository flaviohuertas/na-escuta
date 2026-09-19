import { describe, expect, it } from "vitest";
import { canCreateEvents, canManageEvent, canManageMembers } from "@/lib/domain/permissions";

describe("permissões por papel", () => {
  it("criam eventos: dono, administração e produção — e só eles", () => {
    for (const role of ["OWNER", "ADMIN", "PRODUCER"]) expect(canCreateEvents(role)).toBe(true);
    for (const role of ["STAFF", "FREELANCER", "VIEWER"]) expect(canCreateEvents(role)).toBe(false);
  });

  it("administram pessoas e acessos: dono e administração, não a produção", () => {
    expect(canManageMembers("OWNER")).toBe(true);
    expect(canManageMembers("ADMIN")).toBe(true);
    for (const role of ["PRODUCER", "STAFF", "FREELANCER", "VIEWER"]) expect(canManageMembers(role)).toBe(false);
  });

  it("edita o evento (e convida gente para ele): só o gestor do evento", () => {
    expect(canManageEvent("MANAGER")).toBe(true);
    expect(canManageEvent("FIELD_STAFF")).toBe(false);
    expect(canManageEvent("VIEWER")).toBe(false);
  });

  it("papel desconhecido ou vazio NUNCA pode — falha fechado", () => {
    for (const role of ["", "owner", "SUPERUSER", "manager"]) {
      expect(canCreateEvents(role)).toBe(false);
      expect(canManageMembers(role)).toBe(false);
      expect(canManageEvent(role)).toBe(false);
    }
  });
});
