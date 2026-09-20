import { EVENT_FIELD_LABEL } from "./event-labels";

/**
 * Regras PURAS de uma proposta de correção do evento (sem banco, sem rede): o que mudaria, o que
 * mudou no evento desde a proposta e o que ficaria depois. Servem ao servidor (que decide) e à
 * tela (que mostra) — mesma conta nos dois lados.
 */

/** Os campos do evento que uma proposta pode mexer. Qualquer outro (versão, empresa…) fica de fora. */
export const PROPOSABLE_EVENT_FIELDS = ["name", "description", "location", "startDate", "endDate", "status"] as const;
export type ProposableEventField = (typeof PROPOSABLE_EVENT_FIELDS)[number];

/** Os valores como aparecem numa proposta: datas em ISO, o resto texto; `null` = "sem valor". */
export type EventValues = Partial<Record<ProposableEventField, string | null>>;

/** O evento, com datas como `Date` (servidor) ou ISO (tela). */
export interface EventLike {
  name: string;
  description: string | null;
  location: string | null;
  startDate: Date | string;
  endDate: Date | string;
  status: string;
}

const DATE_FIELDS: ReadonlySet<string> = new Set(["startDate", "endDate"]);
const OPTIONAL_TEXT_FIELDS: ReadonlySet<string> = new Set(["description", "location"]);

export function fieldLabel(field: ProposableEventField): string {
  return EVENT_FIELD_LABEL[field];
}

/** O valor atual do evento num campo, no formato das propostas. */
export function eventValue(event: EventLike, field: ProposableEventField): string | null {
  const value = event[field];
  if (value instanceof Date) return value.toISOString();
  return value ?? null;
}

/** Dois valores do mesmo campo são iguais? Datas comparam o instante (ISO com/sem milissegundos), texto compara o texto. */
export function sameEventValue(field: ProposableEventField, a: string | null | undefined, b: string | null | undefined): boolean {
  const x = a ?? null;
  const y = b ?? null;
  if (x === null || y === null) return x === y;
  if (DATE_FIELDS.has(field)) return new Date(x).getTime() === new Date(y).getTime();
  return x === y;
}

/**
 * O valor como o servidor o grava: texto opcional em branco vira "sem valor" (nunca uma string
 * vazia gravada), datas viram ISO canônico. É o mesmo tratamento da edição direta do evento.
 */
export function normalizeEventValue(field: ProposableEventField, value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  if (DATE_FIELDS.has(field)) return new Date(value).toISOString();
  if (OPTIONAL_TEXT_FIELDS.has(field)) return value.trim() ? value.trim() : null;
  return value.trim();
}

/** Os campos que a proposta realmente MUDA em relação ao evento de agora (o que já é igual não é proposta). */
export function effectiveChanges(current: EventLike, changes: EventValues): EventValues {
  const result: EventValues = {};
  for (const field of PROPOSABLE_EVENT_FIELDS) {
    if (!(field in changes) || changes[field] === undefined) continue;
    const proposed = normalizeEventValue(field, changes[field]);
    if (!sameEventValue(field, eventValue(current, field), proposed)) result[field] = proposed;
  }
  return result;
}

/**
 * Os campos da proposta que MUDARAM no evento depois de ela ser feita — o valor de agora não é mais
 * o que a pessoa via ao propor. Aprovar por cima decidiria sobre um retrato velho e sobrescreveria,
 * sem aviso, a edição de outra pessoa; por isso o servidor recusa e a tela avisa.
 */
export function conflictingFields(before: EventValues, current: EventLike): ProposableEventField[] {
  return PROPOSABLE_EVENT_FIELDS.filter(
    (field) => field in before && !sameEventValue(field, eventValue(current, field), before[field])
  );
}

/** As datas do evento depois de aplicar `after` — o término nunca pode ficar antes do início. */
export function datesStayValid(current: EventLike, after: EventValues): boolean {
  const start = new Date(after.startDate ?? eventValue(current, "startDate")!);
  const end = new Date(after.endDate ?? eventValue(current, "endDate")!);
  return end.getTime() >= start.getTime();
}

/** Uma mudança de um campo, pronta para a tela: o que era, o que é agora, o que se propõe. */
export interface FieldChangeView {
  field: ProposableEventField;
  label: string;
  /** O valor que a pessoa via ao propor. */
  before: string | null;
  /** O valor do evento AGORA. Diferente de `before` = o evento mudou nesse campo (conflito). */
  current: string | null;
  proposed: string | null;
  conflict: boolean;
}

export type ProposalStatus = "PENDING" | "APPROVED" | "REJECTED";

/** Uma proposta como as telas a mostram (JSON puro: datas em ISO). */
export interface ProposalView {
  id: string;
  eventId: string;
  eventName: string;
  submittedBy: { id: string; name: string };
  submittedAt: string;
  status: ProposalStatus;
  reason: string | null;
  changes: FieldChangeView[];
  /** Só nas pendentes: campos que mudaram no evento depois da proposta. Aprovar fica bloqueado. */
  conflictFields: ProposableEventField[];
  /** O formato guardado não conferiu (corrompido, de versão futura): só dá para rejeitar. */
  unreadable: boolean;
  reviewedByName: string | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
}

/** Monta as linhas de "antes → proposto" contra o evento de agora. */
export function buildFieldChanges(stored: { before: EventValues; after: EventValues }, current: EventLike): FieldChangeView[] {
  return PROPOSABLE_EVENT_FIELDS.filter((field) => field in stored.after).map((field) => {
    const now = eventValue(current, field);
    return {
      field,
      label: fieldLabel(field),
      before: stored.before[field] ?? null,
      current: now,
      proposed: stored.after[field] ?? null,
      conflict: !sameEventValue(field, now, stored.before[field]),
    };
  });
}
