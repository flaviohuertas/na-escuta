import { describe, expect, it } from "vitest";
import { ChangePasswordSchema, PASSWORD_MAX_BYTES, PASSWORD_MIN_LENGTH } from "@/lib/domain/password.schema";

const ok = { currentPassword: "Provisoria-1", newPassword: "uma-senha-nova-bem-longa" };
const messageOf = (input: unknown) => {
  const result = ChangePasswordSchema.safeParse(input);
  return result.success ? null : result.error.issues.map((i) => `${String(i.path[0])}: ${i.message}`);
};

describe("ChangePasswordSchema", () => {
  it("aceita uma troca válida", () => {
    expect(ChangePasswordSchema.safeParse(ok).success).toBe(true);
  });

  it(`exige pelo menos ${PASSWORD_MIN_LENGTH} caracteres na nova senha`, () => {
    expect(ChangePasswordSchema.safeParse({ ...ok, newPassword: "a".repeat(PASSWORD_MIN_LENGTH - 1) }).success).toBe(false);
    expect(ChangePasswordSchema.safeParse({ ...ok, newPassword: "a".repeat(PASSWORD_MIN_LENGTH) }).success).toBe(true);
    expect(messageOf({ ...ok, newPassword: "curta" })).toEqual([
      `newPassword: A nova senha precisa ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`,
    ]);
  });

  it(`recusa senha acima de ${PASSWORD_MAX_BYTES} BYTES (o bcrypt truncaria em silêncio), contando bytes e não letras`, () => {
    expect(ChangePasswordSchema.safeParse({ ...ok, newPassword: "a".repeat(PASSWORD_MAX_BYTES) }).success).toBe(true);
    expect(ChangePasswordSchema.safeParse({ ...ok, newPassword: "a".repeat(PASSWORD_MAX_BYTES + 1) }).success).toBe(false);
    // 40 letras acentuadas = 80 bytes em UTF-8: passa em "caracteres", estoura em bytes.
    expect(ChangePasswordSchema.safeParse({ ...ok, newPassword: "é".repeat(40) }).success).toBe(false);
  });

  it("a nova senha tem de ser diferente da atual", () => {
    expect(messageOf({ currentPassword: "mesma-senha-longa", newPassword: "mesma-senha-longa" })).toEqual([
      "newPassword: A nova senha precisa ser diferente da atual.",
    ]);
  });

  it("exige a senha atual", () => {
    expect(messageOf({ ...ok, currentPassword: "" })).toEqual(["currentPassword: Informe a senha atual."]);
  });
});
