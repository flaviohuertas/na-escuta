import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * As regras do sistema de design (docs/design/README.md) que dá para conferir lendo o código. Cada uma
 * já foi quebrada antes, tela a tela; o teste impede a volta.
 */

const files = (readdirSync("src", { recursive: true }) as string[])
  .filter((file) => file.endsWith(".tsx") && !file.includes("generated"))
  .map((file) => ({ file, code: readFileSync(join("src", file), "utf8") }));

function offenders(pattern: RegExp): string[] {
  return files.filter(({ code }) => pattern.test(code)).map(({ file }) => file);
}

describe("sistema de design", () => {
  it("leu os arquivos do app", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("um acento só: nenhuma cor do Tailwind fora da paleta (azul, índigo, cinza frio…)", () => {
    // `slate` (neutros quentes), `emerald` (verde-mar) e `amber` estão remapeados em globals.css; `red`
    // é o de erro. As outras famílias trariam uma segunda cor de destaque ou um cinza frio.
    expect(offenders(/\b(?:bg|text|border|ring|fill|stroke|from|to|divide)-(?:sky|indigo|blue|violet|purple|gray|zinc|neutral|stone|teal|cyan|green|lime|yellow|orange|pink|rose)-\d/)).toEqual([]);
  });

  it("um raio por papel: sem `rounded-md` nem `rounded-2xl` (cartão e botão 12 px, campo e aviso 8 px, selo pílula)", () => {
    expect(offenders(/\brounded-(?:md|2xl|3xl)\b/)).toEqual([]);
  });

  it("voltar é o BackLink do PageHeader (44 px), não uma setinha de texto de 18 px", () => {
    expect(offenders(/←/)).toEqual([]);
  });

  it("tabela que rola de lado é `relative`: senão o texto `sr-only` (do NoValue) escapa da rolagem e alarga a página no celular", () => {
    const loose = files.filter(({ code }) =>
      [...code.matchAll(/className="([^"]*\boverflow-x-auto\b[^"]*)"/g)].some(([, classes]) => !/\brelative\b/.test(classes ?? ""))
    );
    expect(loose.map(({ file }) => file)).toEqual([]);
  });

  it("cartão não tem sombra (a borda e o hover dela dão o retorno); sombra só no painel que flutua", () => {
    expect(offenders(/\bshadow-sm\b|hover:shadow\b/)).toEqual([]);
  });
});
