import { describe, expect, it } from "vitest";
import {
  assignableCompanyRoles,
  canCreateEvents,
  canManageEvent,
  canProposeEventChange,
  canReviewProposals,
  canManageMembers,
  canModifyMember,
} from "@/lib/domain/permissions";

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

  it("propõe correção nos dados do evento: só a equipe de campo (o gestor edita direto; visualização só olha)", () => {
    expect(canProposeEventChange("FIELD_STAFF")).toBe(true);
    expect(canProposeEventChange("MANAGER")).toBe(false);
    expect(canProposeEventChange("VIEWER")).toBe(false);
  });

  it("decide propostas do evento: só o gestor dele", () => {
    expect(canReviewProposals("MANAGER")).toBe(true);
    expect(canReviewProposals("FIELD_STAFF")).toBe(false);
    expect(canReviewProposals("VIEWER")).toBe(false);
  });

  it("quem propõe nunca é quem decide (os dois papéis se excluem)", () => {
    for (const role of ["MANAGER", "FIELD_STAFF", "VIEWER", "", "manager", "SUPERUSER"]) {
      expect(canProposeEventChange(role) && canReviewProposals(role), role).toBe(false);
    }
  });

  it("papel desconhecido ou vazio NUNCA pode — falha fechado", () => {
    for (const role of ["", "owner", "SUPERUSER", "manager", "field_staff"]) {
      expect(canCreateEvents(role)).toBe(false);
      expect(canManageMembers(role)).toBe(false);
      expect(canManageEvent(role)).toBe(false);
      expect(canProposeEventChange(role)).toBe(false);
      expect(canReviewProposals(role)).toBe(false);
    }
  });
});

describe("quem concede e quem altera papéis na empresa", () => {
  it("o titular concede qualquer papel; a administração só os de baixo; os demais, nenhum", () => {
    expect(assignableCompanyRoles("OWNER")).toEqual(["OWNER", "ADMIN", "PRODUCER", "STAFF", "FREELANCER", "VIEWER"]);
    expect(assignableCompanyRoles("ADMIN")).toEqual(["PRODUCER", "STAFF", "FREELANCER", "VIEWER"]);
    for (const role of ["PRODUCER", "STAFF", "FREELANCER", "VIEWER", "", "admin"]) {
      expect(assignableCompanyRoles(role)).toEqual([]);
    }
  });

  it("a administração nunca concede titular nem administração (não delega: escala)", () => {
    const granted = assignableCompanyRoles("ADMIN");
    expect(granted).not.toContain("OWNER");
    expect(granted).not.toContain("ADMIN");
  });

  it("o titular altera qualquer membro; a administração não altera titular nem par", () => {
    for (const target of ["OWNER", "ADMIN", "PRODUCER", "STAFF", "FREELANCER", "VIEWER"]) {
      expect(canModifyMember("OWNER", target)).toBe(true);
    }
    expect(canModifyMember("ADMIN", "OWNER")).toBe(false);
    expect(canModifyMember("ADMIN", "ADMIN")).toBe(false);
    for (const target of ["PRODUCER", "STAFF", "FREELANCER", "VIEWER"]) {
      expect(canModifyMember("ADMIN", target)).toBe(true);
    }
  });

  it("quem não administra não altera ninguém, e papel desconhecido de alvo não abre exceção", () => {
    for (const actor of ["PRODUCER", "STAFF", "FREELANCER", "VIEWER", ""]) {
      expect(canModifyMember(actor, "VIEWER")).toBe(false);
    }
    expect(canModifyMember("OWNER", "SUPERUSER")).toBe(false);
  });
});
