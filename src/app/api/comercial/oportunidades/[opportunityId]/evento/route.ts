import { NextResponse } from "next/server";
import { ConvertToEventSchema } from "@/lib/domain/crm.schema";
import { convertToEvent } from "@/server/crm/opportunity.service";
import { domainErrorResponse, readJsonBody } from "@/server/http/responses";
import { crmSession } from "@/server/http/crm-session";

/** Transforma a oportunidade em evento (a pessoa vira gestora dele) e a marca como ganha — tudo ou nada. */
export async function POST(request: Request, { params }: { params: Promise<{ opportunityId: string }> }) {
  const session = await crmSession();
  if (!session.ok) return session.response;
  const { opportunityId } = await params;
  const body = await readJsonBody(request, ConvertToEventSchema);
  if (!body.ok) return body.response;

  try {
    const { event, opportunity } = await convertToEvent({
      userId: session.userId,
      companyId: session.companyId,
      opportunityId,
      input: body.data,
    });
    return NextResponse.json({ event, opportunity }, { status: 201 });
  } catch (err) {
    const response = domainErrorResponse(err);
    if (response) return response;
    throw err;
  }
}
