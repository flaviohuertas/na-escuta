/**
 * Regras PURAS do comercial (CRM): as etapas do funil, quais movimentos são permitidos, CPF/CNPJ e
 * dinheiro. Sem banco e sem rede — servem ao servidor (que decide) e às telas (que mostram).
 */

// ---------------------------------------------------------------------------
// Funil
// ---------------------------------------------------------------------------

export const OPPORTUNITY_STAGES = ["NEW", "CONTACTED", "PROPOSAL_SENT", "NEGOTIATION", "WON", "LOST"] as const;
export type OpportunityStageName = (typeof OPPORTUNITY_STAGES)[number];

/** As etapas em andamento, na ordem do funil. Ganho e perdido encerram a oportunidade. */
export const OPEN_STAGES = ["NEW", "CONTACTED", "PROPOSAL_SENT", "NEGOTIATION"] as const satisfies readonly OpportunityStageName[];

export const STAGE_LABEL: Record<OpportunityStageName, string> = {
  NEW: "Novo",
  CONTACTED: "Em contato",
  PROPOSAL_SENT: "Proposta enviada",
  NEGOTIATION: "Negociação",
  WON: "Ganho",
  LOST: "Perdido",
};

export function isOpenStage(stage: string): boolean {
  return (OPEN_STAGES as readonly string[]).includes(stage);
}

export interface MoveContext {
  /** A oportunidade já virou um evento. */
  hasEvent: boolean;
}

/**
 * Por que este movimento NÃO é permitido — ou `null` se é. É a única definição: o servidor recusa
 * com esta mensagem e a tela só oferece os botões que passam por aqui.
 *
 * - entre etapas em andamento: livre, para frente ou para trás;
 * - para ganho: de qualquer etapa em andamento;
 * - para perdido: de qualquer etapa em andamento, e só se ainda não virou evento;
 * - de ganho/perdido de volta ao funil ("reabrir"): permitido, exceto ganho que já virou evento;
 * - ganho ↔ perdido direto: não — reabra antes, para o histórico dizer o que aconteceu.
 */
export function explainBlockedMove(from: string, to: string, ctx: MoveContext): string | null {
  if (!(OPPORTUNITY_STAGES as readonly string[]).includes(to)) return "Etapa desconhecida.";
  if (from === to) return "A oportunidade já está nesta etapa.";

  const fromOpen = isOpenStage(from);
  const toOpen = isOpenStage(to);

  if (fromOpen) {
    if (to === "LOST" && ctx.hasEvent) return "Esta oportunidade já virou um evento: não dá para marcá-la como perdida.";
    return null;
  }
  // Saindo de ganho/perdido:
  if (toOpen) {
    if (from === "WON" && ctx.hasEvent) {
      return "Esta oportunidade já virou um evento: não dá para reabri-la. Continue pelo evento.";
    }
    return null;
  }
  return "Reabra a oportunidade antes de mudá-la entre ganho e perdido.";
}

/** As etapas para onde a oportunidade pode ir agora (na ordem do funil). */
export function allowedMoves(from: string, ctx: MoveContext): OpportunityStageName[] {
  return OPPORTUNITY_STAGES.filter((to) => explainBlockedMove(from, to, ctx) === null);
}

/** O motivo da perda: pelo menos isto, para o histórico servir de alguma coisa. */
export const MIN_LOST_REASON_LENGTH = 3;

const OPPORTUNITY_FIELD_LABEL: Record<string, string> = {
  title: "título",
  description: "descrição",
  expectedValueCents: "valor estimado",
  expectedStartDate: "início previsto",
  expectedEndDate: "término previsto",
  ownerUserId: "responsável",
};

const stageLabel = (stage: unknown): string =>
  typeof stage === "string" && stage in STAGE_LABEL ? STAGE_LABEL[stage as OpportunityStageName] : String(stage ?? "—");

/**
 * Uma linha do histórico da oportunidade, em palavras, a partir do que o servidor gravou na
 * auditoria (`action` + o estado antes e depois). Ação desconhecida sai como veio — nunca some.
 */
export function describeOpportunityHistory(action: string, before: unknown, after: unknown): string {
  const b = (before ?? {}) as Record<string, unknown>;
  const a = (after ?? {}) as Record<string, unknown>;
  switch (action) {
    case "OPPORTUNITY_CREATED":
      return "Oportunidade criada.";
    case "OPPORTUNITY_STAGE_CHANGED": {
      const reason = typeof a.lostReason === "string" && a.lostReason ? ` — motivo: ${a.lostReason}` : "";
      return `Etapa: ${stageLabel(b.stage)} → ${stageLabel(a.stage)}${reason}`;
    }
    case "OPPORTUNITY_UPDATED": {
      const changed = Object.keys(OPPORTUNITY_FIELD_LABEL).filter((key) => JSON.stringify(b[key] ?? null) !== JSON.stringify(a[key] ?? null));
      return changed.length > 0
        ? `Editada: ${changed.map((key) => OPPORTUNITY_FIELD_LABEL[key]).join(", ")}.`
        : "Dados da oportunidade editados.";
    }
    case "OPPORTUNITY_CONVERTED":
      return "Virou um evento.";
    default:
      return action;
  }
}

// ---------------------------------------------------------------------------
// CPF / CNPJ
// ---------------------------------------------------------------------------

/** Só os dígitos ("12.345.678/0001-95" → "12345678000195"). */
export function onlyDigits(raw: string): string {
  return raw.replace(/\D/g, "");
}

function allSameDigit(digits: string): boolean {
  return /^(\d)\1+$/.test(digits);
}

export function isValidCpf(digits: string): boolean {
  if (!/^\d{11}$/.test(digits) || allSameDigit(digits)) return false;
  const check = (length: number) => {
    let sum = 0;
    for (let i = 0; i < length; i++) sum += Number(digits[i]) * (length + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return check(9) === Number(digits[9]) && check(10) === Number(digits[10]);
}

export function isValidCnpj(digits: string): boolean {
  if (!/^\d{14}$/.test(digits) || allSameDigit(digits)) return false;
  const check = (length: number) => {
    const weights = length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < length; i++) sum += Number(digits[i]) * weights[i]!;
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return check(12) === Number(digits[12]) && check(13) === Number(digits[13]);
}

/** Um CPF (11 dígitos) ou CNPJ (14) com os dígitos verificadores certos. */
export function isValidDocument(digits: string): boolean {
  return digits.length === 11 ? isValidCpf(digits) : digits.length === 14 ? isValidCnpj(digits) : false;
}

/** Mostra o documento formatado (CPF ou CNPJ); qualquer outra coisa segue como está. */
export function formatDocument(digits: string | null | undefined): string {
  if (!digits) return "";
  if (digits.length === 11) return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  if (digits.length === 14) return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  return digits;
}

// ---------------------------------------------------------------------------
// Dinheiro — sempre em CENTAVOS (inteiro). Ponto flutuante não serve para dinheiro.
// ---------------------------------------------------------------------------

/** Teto de um valor: cabe num `Int` do Postgres com folga (R$ 20 milhões). */
export const MAX_VALUE_CENTS = 2_000_000_000;

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/**
 * Só a data, no horário de Brasília — fixo de propósito: estas telas são renderizadas no servidor
 * e de novo no navegador, e um fuso "do aparelho" daria textos diferentes nos dois lados.
 */
const DATE_ONLY = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" });

export function formatDateBR(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : DATE_ONLY.format(date);
}

export function formatBRL(cents: number): string {
  return BRL.format(cents / 100);
}

/**
 * O que a pessoa digitou ("15.000,00", "15000", "1500,5") em centavos, ou `null` se não é um valor.
 * Estritamente pt-BR: vírgula separa os centavos e ponto separa os milhares. "1.5" NÃO é aceito (é
 * 1 real e meio ou 1500?) — na dúvida, recusa em vez de adivinhar dinheiro.
 */
export function parseBRLToCents(text: string): number | null {
  const cleaned = text.replace(/^R\$\s*/i, "").trim();
  if (!/^(\d{1,3}(\.\d{3})+|\d+)(,\d{1,2})?$/.test(cleaned)) return null;
  const [reais, centavos = ""] = cleaned.replace(/\./g, "").split(",");
  const cents = Number(reais) * 100 + Number(centavos.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

/** Centavos como o campo de texto mostra ("1500000" → "15.000,00"). */
export function centsToInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  const reais = Math.floor(cents / 100);
  const rest = String(cents % 100).padStart(2, "0");
  return `${String(reais).replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${rest}`;
}
