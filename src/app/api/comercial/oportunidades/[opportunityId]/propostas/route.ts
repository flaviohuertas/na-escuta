import { NextResponse } from "next/server";
import { ProposalInputSchema } from "@/lib/domain/proposal.schema";
import { createProposal } from "@/server/crm/proposal.service";
import { domainErrorResponse, readJsonBody } from "@/server/http/responses";
import { crmSession } from "@/server/http/crm-session";

/** Cria um rascunho de proposta (a próxima versão) para a oportunidade. 409 se já há um rascunho ou a oportunidade não está em andamento. */
export async function POST(request: Request, { params }: { params: Promise<{ opportunityId: string }> }) {
  const session = await crmSession();
  if (!session.ok) return session.response;
  const { opportunityId } = await params;
  const body = await readJsonBody(request, ProposalInputSchema);
  if (!body.ok) return body.response;

  try {
    const proposal = await createProposal({ userId: session.userId, companyId: session.companyId, opportunityId, input: body.data });
    return NextResponse.json({ proposal }, { status: 201 });
  } catch (err) {
    const response = domainErrorResponse(err);
    if (response) return response;
    throw err;
  }
}
