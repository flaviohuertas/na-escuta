import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Contraste (WCAG 2.x) dos pares de cor que o sistema usa, medido a partir dos tokens de
 * `src/app/globals.css` — não à mão. Se alguém mexer na paleta e um par deixar de ler bem, falha aqui.
 * Texto comum: 4,5:1. Elementos gráficos (ponto de estado, marca): 3:1.
 */

const css = readFileSync("src/app/globals.css", "utf8");
const theme = css.slice(css.indexOf("@theme"), css.indexOf("}", css.indexOf("@theme")));

const colors: Record<string, string> = { white: "#ffffff", black: "#000000" };
for (const match of theme.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
  const [, name, hex] = match;
  if (name && hex) colors[name] = hex;
}

function hexOf(name: string): string {
  const hex = colors[name];
  if (!hex) throw new Error(`token de cor desconhecido: ${name}`);
  return hex;
}

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

function contrast(fg: string, bg: string): number {
  const [a, b] = [luminance(hexOf(fg)), luminance(hexOf(bg))];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const TEXT = 4.5;
const GRAPHIC = 3;

// [texto/ícone, fundo, mínimo, onde é usado]
const PAIRS: Array<[string, string, number, string]> = [
  // Conteúdo sobre o papel e sobre o branco dos cartões
  ["ink", "paper", 7, "texto principal"],
  ["ink", "white", 7, "texto principal em cartão"],
  ["slate-700", "paper", TEXT, "texto de corpo"],
  ["slate-600", "white", TEXT, "texto secundário"],
  ["slate-500", "white", TEXT, "legendas"],
  ["slate-500", "paper", TEXT, "legendas sobre o papel"],
  ["slate-400", "white", TEXT, "texto pequeno mais apagado (o mais claro permitido)"],
  ["slate-400", "paper", TEXT, "idem, sobre o papel"],
  // Marca
  ["white", "brand-600", TEXT, "texto do botão primário"],
  ["brand-600", "white", TEXT, "link / texto de marca em cartão"],
  ["brand-600", "paper", TEXT, "link / texto de marca sobre o papel"],
  ["brand-700", "white", TEXT, "link (hover) e aba ativa"],
  ["brand-700", "paper", TEXT, "idem, sobre o papel"],
  ["brand-800", "brand-50", TEXT, "item ativo do painel Mais"],
  ["brand-800", "brand-100", TEXT, "selo de marca"],
  // Superfícies escuras (barra lateral, barra da conta)
  ["white", "ink", 7, "item ativo e título na barra lateral"],
  ["slate-200", "ink", 7, "itens da barra lateral"],
  ["slate-100", "ink", 7, "botão Sair"],
  ["ink-muted", "ink", TEXT, "rótulos de grupo e nome da pessoa"],
  // Estados que aparecem como TEXTO na barra de sincronização
  ["status-conflict", "white", TEXT, "conflitos para resolver"],
  ["status-error", "white", TEXT, "erro ao sincronizar"],
  ["status-syncing", "white", TEXT, "sincronizando"],
  ["status-pending", "white", TEXT, "pendentes"],
  ["status-pending", "paper", TEXT, "pendentes sobre o papel"],
  ["status-offline", "white", TEXT, "offline"],
  ["status-synced", "white", TEXT, "evento preparado, exportado"],
  ["status-synced", "paper", TEXT, "idem, sobre o papel"],
  // Selos e números de situação (Badge, Stat): verde-mar (emerald remapeado) e âmbar da referência
  ["emerald-900", "emerald-100", TEXT, "selo de sucesso (Dentro do previsto, Aceita, Em dia)"],
  ["emerald-900", "emerald-50", TEXT, "aviso de sucesso e 'Tudo em dia' do Painel"],
  ["emerald-800", "white", TEXT, "margem positiva num cartão"],
  ["emerald-800", "paper", TEXT, "margem positiva sobre o papel"],
  ["emerald-800", "emerald-50", TEXT, "aviso de sucesso (texto 800)"],
  ["amber-900", "amber-100", TEXT, "selo de atenção (Sem previsão, Vencida)"],
  ["amber-900", "amber-50", TEXT, "aviso de atenção"],
  ["amber-800", "amber-50", TEXT, "número de alerta no cartão âmbar do Painel"],
  ["amber-800", "white", TEXT, "número de alerta em cartão branco"],
  ["amber-800", "paper", TEXT, "aviso curto sobre o papel (lista truncada)"],
  ["slate-700", "slate-100", TEXT, "selo neutro"],
  // Componentes de interface (WCAG 1.4.11, 3:1): onde o campo começa e onde está o foco
  ["slate-400", "white", GRAPHIC, "borda dos campos de formulário"],
  ["slate-400", "paper", GRAPHIC, "borda dos campos sobre o papel"],
  ["slate-400", "slate-100", GRAPHIC, "borda do campo desabilitado (fundo slate-100)"],
  ["brand-600", "white", GRAPHIC, "contorno de foco"],
  ["brand-600", "paper", GRAPHIC, "contorno de foco sobre o papel"],
  // Elementos gráficos
  ["status-synced", "white", GRAPHIC, "ponto de online"],
  ["brand-500", "ink", GRAPHIC, "marca sobre a tinta"],
  ["brand-500", "ink-soft", GRAPHIC, "marca sobre o quadrado da barra lateral"],
];

describe("tokens de cor: contraste medido", () => {
  it("leu os tokens que os pares citam", () => {
    const wanted = new Set(PAIRS.flatMap(([fg, bg]) => [fg, bg]));
    for (const name of wanted) expect(colors[name], `token ${name}`).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it.each(PAIRS)("%s sobre %s ≥ %s:1 (%s)", (fg, bg, min) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(min);
  });

  it("o cinza legível sobre a tinta é mais claro que o cinza legível sobre o papel", () => {
    // Guarda contra usar `text-slate-400` (escuro) em fundo escuro: o par certo para a tinta é `ink-muted`.
    expect(contrast("slate-400", "ink")).toBeLessThan(TEXT);
    expect(contrast("ink-muted", "ink")).toBeGreaterThanOrEqual(TEXT);
  });
});

/**
 * As BORDAS de campo, medidas a partir das classes que o app de fato usa (não de uma lista à parte).
 * Antes o campo tinha `border-slate-300` (1,5:1) e ninguém notou: o axe não mede borda, e o teste acima só
 * media texto. O WCAG 1.4.11 pede 3:1 para reconhecer onde o campo começa.
 */
describe("bordas dos campos", () => {
  const field = readFileSync("src/components/ui/Field.tsx", "utf8");

  function borderTokenOf(constName: string): string {
    const declaration = field.match(new RegExp(`export const ${constName} =\\s*"([^"]+)"`));
    if (!declaration?.[1]) throw new Error(`não achei ${constName} em Field.tsx`);
    const border = declaration[1].match(/\bborder-(slate-\d+)\b/);
    if (!border?.[1]) throw new Error(`${constName} não declara a cor da borda`);
    return border[1];
  }

  it.each(["inputClass", "compactSelectClass"])("%s: a borda passa de 3:1 sobre o branco e sobre o papel", (constName) => {
    const token = borderTokenOf(constName);
    expect(contrast(token, "white")).toBeGreaterThanOrEqual(GRAPHIC);
    expect(contrast(token, "paper")).toBeGreaterThanOrEqual(GRAPHIC);
  });

  it("nenhum arquivo do app volta a escrever o campo à mão com a borda clara ou o anel fraco de antes", () => {
    // Só CAMPO (`mt-1 …`, como os antigos): botões secundários também usam `border-slate-300`, e a borda deles
    // não é o que os identifica (o texto é).
    const stale = /mt-1 (w-full )?rounded-md border border-slate-300|focus:ring-brand-200/;
    const offenders = (readdirSync("src", { recursive: true }) as string[])
      .filter((file) => file.endsWith(".tsx"))
      .filter((file) => stale.test(readFileSync(join("src", file), "utf8")));
    expect(offenders).toEqual([]);
  });
});
