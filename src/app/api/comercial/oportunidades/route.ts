import { NextResponse } from "next/server";
import { OpportunityInputSchema } from "@/lib/domain/crm.schema";
import { createOpportunity } from "@/server/crm/opportunity.service";
import { domainErrorResponse, readJsonBody } from "@/server/http/responses";
import { crmSession } from "@/server/http/crm-session";

/** Abre uma oportunidade para um cliente ativo. Exige conexão. */
export async function POST(request: Request) {
  const session = await crmSession();
  if (!session.ok) return session.response;
  const body = await readJsonBody(request, OpportunityInputSchema);
  if (!body.ok) return body.response;

  try {
    const opportunity = await createOpportunity({ userId: session.userId, companyId: session.companyId, input: body.data });
    return NextResponse.json({ opportunity }, { status: 201 });
  } catch (err) {
    const response = domainErrorResponse(err);
    if (response) return response;
    throw err;
  }
}
