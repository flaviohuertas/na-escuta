import { readFileSync } from "node:fs";
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
