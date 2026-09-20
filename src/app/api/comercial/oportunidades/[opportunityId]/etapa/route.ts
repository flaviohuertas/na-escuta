import { NextResponse } from "next/server";
import { StageMoveSchema } from "@/lib/domain/crm.schema";
import { moveStage } from "@/server/crm/opportunity.service";
import { domainErrorResponse, readJsonBody } from "@/server/http/responses";
import { crmSession } from "@/server/http/crm-session";

/** Move a oportunidade no funil. Perder exige o motivo; 409 se o movimento não é permitido ou outra pessoa mexeu antes. */
export async function POST(request: Request, { params }: { params: Promise<{ opportunityId: string }> }) {
  const session = await crmSession();
  if (!session.ok) return session.response;
  const { opportunityId } = await params;
  const body = await readJsonBody(request, StageMoveSchema);
  if (!body.ok) return body.response;

  try {
    const opportunity = await moveStage({ userId: session.userId, companyId: session.companyId, opportunityId, input: body.data });
    return NextResponse.json({ opportunity });
  } catch (err) {
    const response = domainErrorResponse(err);
    if (response) return response;
    throw err;
  }
}
