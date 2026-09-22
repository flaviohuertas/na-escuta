/**
 * Primeiro passo do módulo de contas a pagar/receber: regras puras do vencimento e do status.
 * Mantém o comportamento simples e testável antes de abrir um modelo completo na API.
 */

export type PayableStatus = "OPEN" | "OVERDUE" | "PAID" | "CANCELLED";

export const PAYABLE_STATUS_LABEL: Record<PayableStatus, string> = {
  OPEN: "Em aberto",
  OVERDUE: "Vencida",
  PAID: "Paga",
  CANCELLED: "Cancelada",
};

export function payableStatusLabel(status: PayableStatus): string {
  return PAYABLE_STATUS_LABEL[status];
}

export interface PayableStatusContext {
  dueDate: string;
  paidAt: string | null;
  cancelledAt: string | null;
  today: string;
}

/**
 * Status real de um pagamento/conta: paga, vencida ou aberta, além de cancelada.
 * A mesma regra serve para contas a pagar e a receber.
 */
export function classifyPayable(ctx: PayableStatusContext): PayableStatus {
  if (ctx.cancelledAt) return "CANCELLED";
  if (ctx.paidAt) return "PAID";
  if (ctx.dueDate < ctx.today) return "OVERDUE";
  return "OPEN";
}

export function describePayableStatus(ctx: PayableStatusContext): string {
  const status = classifyPayable(ctx);
  switch (status) {
    case "PAID":
      return "Paga.";
    case "OVERDUE":
      return `Vencida em ${formatDateOnlyBR(ctx.dueDate)}.`;
    case "CANCELLED":
      return "Cancelada.";
    default:
      return `Em aberto até ${formatDateOnlyBR(ctx.dueDate)}.`;
  }
}

function formatDateOnlyBR(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}
