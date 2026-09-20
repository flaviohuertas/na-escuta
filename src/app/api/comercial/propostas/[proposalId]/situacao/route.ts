import { NextResponse } from "next/server";
import { ProposalActionSchema } from "@/lib/domain/proposal.schema";
import { changeProposalStatus } from "@/server/crm/proposal.service";
import { domainErrorResponse, readJsonBody } from "@/server/http/responses";
import { crmSession } from "@/server/http/crm-session";

/**
 * Enviar, aceitar, recusar ou descartar a proposta. 409 se a ação não é permitida na situação
 * atual ou se outra pessoa mexeu antes. `proposal` volta `null` quando o rascunho é descartado.
 */
export async function POST(request: Request, { params }: { params: Promise<{ proposalId: string }> }) {
  const session = await crmSession();
  if (!session.ok) return session.response;
  const { proposalId } = await params;
  const body = await readJsonBody(request, ProposalActionSchema);
  if (!body.ok) return body.response;

  try {
    const result = await changeProposalStatus({ userId: session.userId, companyId: session.companyId, proposalId, input: body.data });
    return NextResponse.json({ proposal: result.proposal, opportunity: result.opportunity });
  } catch (err) {
    const response = domainErrorResponse(err);
    if (response) return response;
    throw err;
  }
}
