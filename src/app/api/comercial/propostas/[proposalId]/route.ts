import { NextResponse } from "next/server";
import { ProposalUpdateSchema } from "@/lib/domain/proposal.schema";
import { updateProposal } from "@/server/crm/proposal.service";
import { domainErrorResponse, readJsonBody } from "@/server/http/responses";
import { crmSession } from "@/server/http/crm-session";

/** Edita o rascunho da proposta. 409 se já não é rascunho ou se outra pessoa mexeu antes (versão). */
export async function PATCH(request: Request, { params }: { params: Promise<{ proposalId: string }> }) {
  const session = await crmSession();
  if (!session.ok) return session.response;
  const { proposalId } = await params;
  const body = await readJsonBody(request, ProposalUpdateSchema);
  if (!body.ok) return body.response;

  try {
    const proposal = await updateProposal({ userId: session.userId, companyId: session.companyId, proposalId, input: body.data });
    return NextResponse.json({ proposal });
  } catch (err) {
    const response = domainErrorResponse(err);
    if (response) return response;
    throw err;
  }
}
