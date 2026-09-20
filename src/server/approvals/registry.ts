import type { Event, PendingApproval, Prisma } from "@/generated/prisma/client";
import type { FieldChangeView, ProposableEventField } from "@/lib/domain/approval";
import { EVENT_CHANGE_ENTITY_TYPE } from "@/lib/domain/approval.schema";
import { eventChangeApplier } from "./event-change";

/** A proposta com o evento a que se refere (o que as telas e os aplicadores precisam ler). */
export type ApprovalWithEvent = PendingApproval & { event: Event };

/** O que uma proposta APROVADA fez, para o histórico de auditoria. */
// `type` e não `interface`: vai para uma coluna JSON, e só um alias de objeto é atribuível a um `InputJsonObject`.
export type AppliedChange = {
  entityType: string;
  entityId: string;
  before: Prisma.InputJsonValue;
  after: Prisma.InputJsonValue;
};

export interface PresentedProposal {
  changes: FieldChangeView[];
  conflictFields: ProposableEventField[];
  reason: string | null;
  /** O JSON guardado não conferiu com o formato do tipo: a tela só oferece rejeitar. */
  unreadable: boolean;
}

/**
 * Cada TIPO de proposta (`PendingApproval.entityType`) traz o seu aplicador: o motor decide quem
 * pode decidir e cuida de concorrência, auditoria e estado; o aplicador sabe o que a mudança é e
 * como aplicá-la. Orçamentos, contratos e financeiro entram registrando o seu aqui, sem tocar no motor.
 */
export interface ApprovalApplier {
  /** Quem, pelo papel no evento, pode aprovar/rejeitar propostas deste tipo. */
  canReview(eventRole: string): boolean;
  /**
   * Aplica a proposta APROVADA, dentro da transação de quem decide (o evento já está travado).
   * Lança `AdminActionError` (409/422) se não dá mais para aplicar — a transação inteira desfaz e a
   * proposta continua pendente.
   */
  apply(tx: Prisma.TransactionClient, approval: PendingApproval, reviewerId: string): Promise<AppliedChange>;
  /** O que a proposta muda, contra o estado de agora — para a tela. */
  present(approval: ApprovalWithEvent): PresentedProposal;
}

const APPLIERS: Record<string, ApprovalApplier> = {
  [EVENT_CHANGE_ENTITY_TYPE]: eventChangeApplier,
};

/** Tipo desconhecido = `undefined`: quem chama recusa. Falha fechado — nunca aplica o que não conhece. */
export function applierFor(entityType: string): ApprovalApplier | undefined {
  return Object.prototype.hasOwnProperty.call(APPLIERS, entityType) ? APPLIERS[entityType] : undefined;
}
