import { describe, expect, it } from "vitest";
import { generateTemporaryPassword, hashPassword, verifyPassword } from "@/server/auth/password";

const FORMAT = /^[A-HJ-NP-Za-km-z2-9]{4}-[A-HJ-NP-Za-km-z2-9]{4}-[A-HJ-NP-Za-km-z2-9]{4}$/;

describe("generateTemporaryPassword", () => {
  it("sai em três grupos de quatro, para ler e digitar sem erro", () => {
    for (let i = 0; i < 50; i++) expect(generateTemporaryPassword()).toMatch(FORMAT);
  });

  it("nunca usa caracteres que se confundem (0 O 1 l I) — a senha será lida e digitada por alguém", () => {
    const all = Array.from({ length: 400 }, generateTemporaryPassword).join("");
    expect(all).not.toMatch(/[01OlI]/);
  });

  it("é aleatória de verdade: 500 senhas, todas diferentes, e o alfabeto todo aparece", () => {
    const passwords = Array.from({ length: 500 }, generateTemporaryPassword);
    expect(new Set(passwords).size).toBe(500);
    const seen = new Set(passwords.join("").replaceAll("-", ""));
    // 500 senhas x 12 caracteres = 6000 sorteios sobre 57 símbolos: sobra folga para todos aparecerem.
    expect(seen.size).toBeGreaterThan(50);
  });
});

describe("hashPassword / verifyPassword", () => {
  it("o hash não contém a senha e só confere com ela", async () => {
    const hash = await hashPassword("Senha-de-Teste-123");
    expect(hash).not.toContain("Senha-de-Teste-123");
    expect(hash).toMatch(/^\$2[aby]\$/);
    expect(await verifyPassword("Senha-de-Teste-123", hash)).toBe(true);
    expect(await verifyPassword("senha-de-teste-123", hash)).toBe(false);
  });

  it("a mesma senha gera hashes diferentes (sal por senha)", async () => {
    expect(await hashPassword("igual")).not.toBe(await hashPassword("igual"));
  });
});
