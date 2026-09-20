import { NextResponse } from "next/server";
import { OpportunityUpdateSchema } from "@/lib/domain/crm.schema";
import { updateOpportunity } from "@/server/crm/opportunity.service";
import { domainErrorResponse, readJsonBody } from "@/server/http/responses";
import { crmSession } from "@/server/http/crm-session";

/** Edita os dados da oportunidade (a etapa muda em `/etapa`, o cliente não muda). */
export async function PATCH(request: Request, { params }: { params: Promise<{ opportunityId: string }> }) {
  const session = await crmSession();
  if (!session.ok) return session.response;
  const { opportunityId } = await params;
  const body = await readJsonBody(request, OpportunityUpdateSchema);
  if (!body.ok) return body.response;

  try {
    const opportunity = await updateOpportunity({ userId: session.userId, companyId: session.companyId, opportunityId, input: body.data });
    return NextResponse.json({ opportunity });
  } catch (err) {
    const response = domainErrorResponse(err);
    if (response) return response;
    throw err;
  }
}
