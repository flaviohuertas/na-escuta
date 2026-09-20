import { prisma } from "@/lib/db/prisma";
import type { AuditLog } from "@/generated/prisma/client";
import { describeBudgetHistory } from "@/lib/domain/budget";
import { describeOpportunityHistory } from "@/lib/domain/crm";
import { describeProposalHistory } from "@/lib/domain/proposal";

export interface HistoryEntry {
  id: string;
  at: Date;
  actorName: string | null;
  text: string;
}

/** A linha do histórico em palavras: proposta, orçamento e oportunidade têm redações próprias. */
export function describeAudit(entry: Pick<AuditLog, "action" | "beforeJson" | "afterJson" | "metadata">): string {
  if (entry.action.startsWith("PROPOSAL_")) return describeProposalHistory(entry.action, entry.beforeJson, entry.afterJson, entry.metadata);
  if (entry.action.startsWith("BUDGET_")) return describeBudgetHistory(entry.action, entry.beforeJson, entry.afterJson);
  return describeOpportunityHistory(entry.action, entry.beforeJson, entry.afterJson, entry.metadata);
}

/** As linhas da auditoria (já ordenadas) como histórico legível, com o nome de quem fez cada coisa. */
export async function toHistory(audit: AuditLog[]): Promise<HistoryEntry[]> {
  const actorIds = [...new Set(audit.map((a) => a.userId).filter((id): id is string => id !== null))];
  const actors = actorIds.length ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } }) : [];
  const nameOf = new Map(actors.map((a) => [a.id, a.name]));

  return audit.map((a) => ({
    id: a.id,
    at: a.createdAt,
    actorName: a.userId ? (nameOf.get(a.userId) ?? null) : null,
    text: describeAudit(a),
  }));
}
