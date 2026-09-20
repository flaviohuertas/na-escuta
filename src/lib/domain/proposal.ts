/**
 * Regras PURAS das propostas comerciais: os totais (sempre em centavos inteiros), a validade (só a
 * data, no horário de Brasília), quais ações são permitidas em cada situação e o histórico em
 * palavras. Sem banco e sem rede — servem ao servidor (que decide) e às telas (que mostram).
 */
import { MAX_VALUE_CENTS, formatBRL, isOpenStage } from "./crm";

// ---------------------------------------------------------------------------
// Situações
// ---------------------------------------------------------------------------

export const PROPOSAL_STATUSES = ["DRAFT", "SENT", "ACCEPTED", "REJECTED", "SUPERSEDED"] as const;
export type ProposalStatusName = (typeof PROPOSAL_STATUSES)[number];

export const PROPOSAL_STATUS_LABEL: Record<ProposalStatusName, string> = {
  DRAFT: "Rascunho",
  SENT: "Enviada",
  ACCEPTED: "Aceita",
  REJECTED: "Recusada",
  SUPERSEDED: "Substituída",
};

export const MAX_ITEMS = 100;
export const MAX_QUANTITY = 100_000;
export const MAX_ITEM_DESCRIPTION = 200;
export const MAX_NOTES = 4000;
export const MAX_DECISION_NOTE = 500;

// ---------------------------------------------------------------------------
// Totais
// ---------------------------------------------------------------------------

export interface ProposalLine {
  quantity: number;
  unitPriceCents: number;
}

export interface ProposalTotals {
  /** O total de cada item (quantidade × preço), na ordem dos itens. */
  lineTotals: number[];
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
}

/**
 * Os totais da proposta, em centavos inteiros: cada item = quantidade × preço; subtotal = soma dos
 * itens; total = subtotal − desconto. É a ÚNICA conta — o servidor grava o que sai daqui e a tela
 * mostra o mesmo número enquanto a pessoa digita. Não valida (veja `totalsProblems`).
 */
export function computeTotals(items: readonly ProposalLine[], discountCents: number): ProposalTotals {
  const lineTotals = items.map((item) => item.quantity * item.unitPriceCents);
  const subtotalCents = lineTotals.reduce((sum, line) => sum + line, 0);
  return { lineTotals, subtotalCents, discountCents, totalCents: subtotalCents - discountCents };
}

export interface TotalsProblem {
  path: Array<string | number>;
  message: string;
}

/** O que está errado nos valores: item ou subtotal acima do teto, desconto maior que o subtotal. */
export function totalsProblems(items: readonly ProposalLine[], discountCents: number): TotalsProblem[] {
  const problems: TotalsProblem[] = [];
  let subtotal = 0;
  items.forEach((item, index) => {
    const line = item.quantity * item.unitPriceCents;
    if (line > MAX_VALUE_CENTS) {
      problems.push({ path: ["items", index, "unitPriceCents"], message: "O total deste item passa do limite de R$ 20 milhões." });
    }
    subtotal += line;
  });
  if (subtotal > MAX_VALUE_CENTS) {
    problems.push({ path: ["items"], message: "O subtotal da proposta passa do limite de R$ 20 milhões." });
  }
  if (discountCents > subtotal) {
    problems.push({ path: ["discountCents"], message: "O desconto não pode ser maior que o subtotal." });
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Validade — só a DATA ("2027-01-10", o último dia em que a proposta vale), no horário de Brasília
// ---------------------------------------------------------------------------

const SAO_PAULO_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Hoje em Brasília, como "2027-01-10". Fixo de propósito: o servidor e o navegador têm de concordar. */
export function todayInSaoPaulo(now: Date = new Date()): string {
  const parts = Object.fromEntries(SAO_PAULO_DAY.formatToParts(now).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** "2027-02-29" não existe: confere o dia de verdade, não só o formato. */
export function isValidDateOnly(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const date = new Date(`${text}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

/** A data como o banco devolve (`@db.Date`: meia-noite UTC) em "2027-01-10". */
export function dateOnlyFromDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function dateOnlyToDate(text: string): Date {
  return new Date(`${text}T00:00:00.000Z`);
}

/** "2027-01-10" → "10/01/2027". Sem fuso: é um dia do calendário, não um instante. */
export function formatDateOnlyBR(text: string | null | undefined): string {
  if (!text || !isValidDateOnly(text)) return "—";
  const [year, month, day] = text.split("-");
  return `${day}/${month}/${year}`;
}

/** Venceu: o último dia de validade já passou (no próprio dia da validade ainda vale). */
export function isExpired(validUntil: string | null, today: string): boolean {
  return validUntil !== null && validUntil < today;
}

// ---------------------------------------------------------------------------
// O que cada situação permite
// ---------------------------------------------------------------------------

export type ProposalActionName = "EDIT" | "SEND" | "ACCEPT" | "REJECT" | "DISCARD";

export interface ProposalContext {
  status: string;
  /** A etapa da oportunidade. */
  oppStage: string;
  /** A oportunidade já virou um evento. */
  hasEvent: boolean;
  validUntil: string | null;
  today: string;
  itemCount: number;
  totalCents: number;
}

const EVENT_MESSAGE = "Esta oportunidade já virou um evento: as propostas ficam só para consulta.";

function opportunityBlock(oppStage: string, hasEvent: boolean): string | null {
  if (hasEvent) return EVENT_MESSAGE;
  if (oppStage === "WON") return "Esta oportunidade já está ganha. Reabra-a para mexer nas propostas.";
  if (!isOpenStage(oppStage)) return "Esta oportunidade está perdida. Reabra-a para mexer nas propostas.";
  return null;
}

/** Criar uma proposta nova (ou uma nova versão): só com a oportunidade em andamento e sem evento. */
export function explainBlockedProposalCreate(ctx: { oppStage: string; hasEvent: boolean }): string | null {
  return opportunityBlock(ctx.oppStage, ctx.hasEvent);
}

/**
 * Por que esta ação NÃO é permitida agora — ou `null` se é. É a única definição: o servidor recusa
 * com esta mensagem e a tela só oferece os botões que passam por aqui.
 *
 * - editar: só rascunho, com a oportunidade em andamento;
 * - descartar: só rascunho (limpar um rascunho esquecido nunca faz mal);
 * - enviar: rascunho completo (itens, total maior que zero, validade que ainda vale), com a
 *   oportunidade em andamento;
 * - aceitar: só enviada e ainda dentro da validade; oportunidade em andamento ou já ganha
 *   (perdida: reabra antes);
 * - recusar: só enviada.
 * Depois que a oportunidade vira evento, nada mais muda (só descartar rascunho).
 */
export function explainBlockedProposalAction(action: ProposalActionName, ctx: ProposalContext): string | null {
  if (!(PROPOSAL_STATUSES as readonly string[]).includes(ctx.status)) return "Situação da proposta desconhecida.";

  switch (action) {
    case "EDIT":
      if (ctx.status !== "DRAFT") {
        return "Só rascunhos podem ser editados. Para mudar uma proposta já enviada, crie uma nova versão.";
      }
      return opportunityBlock(ctx.oppStage, ctx.hasEvent);

    case "DISCARD":
      return ctx.status === "DRAFT" ? null : "Só rascunhos podem ser descartados. Uma proposta enviada fica no histórico.";

    case "SEND": {
      if (ctx.status !== "DRAFT") return "Esta proposta não é mais um rascunho.";
      const opp = opportunityBlock(ctx.oppStage, ctx.hasEvent);
      if (opp) return opp;
      if (ctx.itemCount < 1) return "Inclua ao menos um item antes de enviar.";
      if (ctx.totalCents <= 0) return "O total da proposta precisa ser maior que zero para enviá-la.";
      if (ctx.validUntil === null) return "Defina até quando a proposta vale antes de enviá-la.";
      if (isExpired(ctx.validUntil, ctx.today)) {
        return `A validade (${formatDateOnlyBR(ctx.validUntil)}) já passou. Ajuste a data antes de enviar.`;
      }
      return null;
    }

    case "ACCEPT":
      if (ctx.status !== "SENT") return "Só uma proposta enviada pode ser aceita.";
      if (ctx.hasEvent) return EVENT_MESSAGE;
      if (ctx.oppStage === "LOST") return "Esta oportunidade está perdida. Reabra-a antes de aceitar a proposta.";
      if (isExpired(ctx.validUntil, ctx.today)) {
        return `A validade venceu em ${formatDateOnlyBR(ctx.validUntil)}. Crie uma nova versão com uma nova validade.`;
      }
      return null;

    case "REJECT":
      if (ctx.status !== "SENT") return "Só uma proposta enviada pode ser recusada.";
      return ctx.hasEvent ? EVENT_MESSAGE : null;
  }
}

/** As ações permitidas agora, para a tela oferecer só essas. */
export function allowedProposalActions(ctx: ProposalContext): ProposalActionName[] {
  return (["EDIT", "SEND", "ACCEPT", "REJECT", "DISCARD"] as const).filter((action) => explainBlockedProposalAction(action, ctx) === null);
}

/**
 * Enviar a proposta leva a oportunidade para "Proposta enviada" — só PARA A FRENTE: quem já está em
 * negociação não volta atrás porque uma nova versão foi enviada.
 */
export function stageAfterSend(stage: string): "PROPOSAL_SENT" | null {
  return stage === "NEW" || stage === "CONTACTED" ? "PROPOSAL_SENT" : null;
}

// ---------------------------------------------------------------------------
// Histórico
// ---------------------------------------------------------------------------

const PROPOSAL_FIELD_LABEL: Array<[string, string]> = [
  ["items", "itens"],
  ["discountCents", "desconto"],
  ["validUntil", "validade"],
  ["notes", "observações"],
];

const asRecord = (value: unknown): Record<string, unknown> => (value && typeof value === "object" ? (value as Record<string, unknown>) : {});

/**
 * Uma linha do histórico de proposta, em palavras, a partir do que o servidor gravou na auditoria.
 * Ação desconhecida sai como veio — nunca some.
 */
export function describeProposalHistory(action: string, before: unknown, after: unknown, metadata?: unknown): string {
  const b = asRecord(before);
  const a = asRecord(after);
  const m = asRecord(metadata);
  const number = a.number ?? b.number;
  const label = `Proposta v${number ?? "?"}`;
  const note = (value: unknown) => (typeof value === "string" && value ? ` — ${value}` : "");

  switch (action) {
    case "PROPOSAL_CREATED":
      return typeof m.copiedFromNumber === "number" ? `${label} criada a partir da v${m.copiedFromNumber}.` : `${label} criada.`;
    case "PROPOSAL_UPDATED": {
      const changed = PROPOSAL_FIELD_LABEL.filter(([key]) => JSON.stringify(b[key] ?? null) !== JSON.stringify(a[key] ?? null)).map(([, name]) => name);
      return changed.length > 0 ? `${label} editada: ${changed.join(", ")}.` : `${label} editada.`;
    }
    case "PROPOSAL_SENT": {
      const total = typeof a.totalCents === "number" ? formatBRL(a.totalCents) : null;
      const until = typeof a.validUntil === "string" ? formatDateOnlyBR(a.validUntil) : null;
      const detail = [total, until ? `válida até ${until}` : null].filter(Boolean).join(", ");
      return `${label} marcada como enviada${detail ? ` (${detail})` : ""}.`;
    }
    case "PROPOSAL_SUPERSEDED":
      return typeof m.supersededByNumber === "number" ? `${label} substituída pela v${m.supersededByNumber}.` : `${label} substituída por uma nova versão.`;
    case "PROPOSAL_ACCEPTED":
      return `${label} aceita pelo cliente${note(m.note)}.`;
    case "PROPOSAL_REJECTED":
      return `${label} recusada pelo cliente${note(m.note)}.`;
    case "PROPOSAL_DISCARDED":
      return `Rascunho da ${label.toLowerCase()} descartado.`;
    default:
      return action;
  }
}
