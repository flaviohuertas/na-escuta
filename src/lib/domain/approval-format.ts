import type { EventStatus } from "./event.schema";
import { EVENT_STATUS_LABEL } from "./event-labels";
import type { ProposableEventField } from "./approval";

/**
 * O fuso é FIXO (Brasília) de propósito: estas telas são renderizadas no servidor e de novo no
 * navegador, e um fuso "do aparelho" daria textos diferentes nos dois lados (aviso de hidratação do
 * React e um horário que muda conforme quem olha). Mesma escolha da agenda do Painel.
 */
const DATE_TIME = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatDateTimeBR(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : DATE_TIME.format(date);
}

/** Um valor de um campo do evento como a pessoa lê; "sem valor" quando está vazio. */
export function formatChangeValue(field: ProposableEventField, value: string | null): string {
  if (value === null || value === "") return "— (sem valor)";
  if (field === "startDate" || field === "endDate") return formatDateTimeBR(value);
  if (field === "status") return EVENT_STATUS_LABEL[value as EventStatus] ?? value;
  return value;
}
