import { describe, expect, it } from "vitest";
import { AddMemberSchema, ChangeMemberSchema, EmailSchema } from "@/lib/domain/team.schema";

describe("EmailSchema", () => {
  it("normaliza para minúsculo e sem espaços: 'Ana@X.com' e 'ana@x.com' são a MESMA pessoa no login", () => {
    expect(EmailSchema.parse("  Ana.Souza@Produtora.COM.br  ")).toBe("ana.souza@produtora.com.br");
  });

  it("recusa o que não é e-mail, com mensagem clara", () => {
    for (const bad of ["", "sem-arroba", "a@", "@x.com", "a b@x.com"]) {
      const result = EmailSchema.safeParse(bad);
      expect(result.success, bad).toBe(false);
    }
    expect(EmailSchema.safeParse("sem-arroba").error?.issues[0]?.message).toBe("Informe um e-mail válido.");
  });

  it("recusa e-mail longo demais", () => {
    expect(EmailSchema.safeParse(`${"a".repeat(250)}@x.com`).success).toBe(false);
  });
});

describe("AddMemberSchema", () => {
  const valid = { name: "Pessoa Nova", email: "Nova@X.com", role: "STAFF" };

  it("aceita e devolve o e-mail normalizado e o nome sem espaços nas pontas", () => {
    expect(AddMemberSchema.parse({ ...valid, name: "  Pessoa Nova  " })).toEqual({
      name: "Pessoa Nova",
      email: "nova@x.com",
      role: "STAFF",
    });
  });

  it("nome curto demais, papel inexistente e e-mail inválido são recusados", () => {
    expect(AddMemberSchema.safeParse({ ...valid, name: " a " }).error?.issues[0]?.message).toBe("Informe o nome da pessoa.");
    expect(AddMemberSchema.safeParse({ ...valid, role: "SUPERUSER" }).success).toBe(false);
    expect(AddMemberSchema.safeParse({ ...valid, email: "x" }).success).toBe(false);
  });
});

describe("ChangeMemberSchema", () => {
  it("exige o papel, a situação ou a conta (ao menos um)", () => {
    expect(ChangeMemberSchema.safeParse({}).success).toBe(false);
    expect(ChangeMemberSchema.safeParse({ role: "VIEWER" }).success).toBe(true);
    expect(ChangeMemberSchema.safeParse({ status: "REVOKED" }).success).toBe(true);
    expect(ChangeMemberSchema.safeParse({ isActive: false }).success).toBe(true);
    expect(ChangeMemberSchema.safeParse({ status: "PENDING" }).success).toBe(false);
  });
});
