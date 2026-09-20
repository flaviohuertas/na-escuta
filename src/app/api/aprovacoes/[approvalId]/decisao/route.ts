import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth.config";
import { ReviewDecisionSchema } from "@/lib/domain/approval.schema";
import { decideProposal } from "@/server/approvals/approval.service";
import { domainErrorResponse, readJsonBody } from "@/server/http/responses";

/** O gestor do evento aprova ou rejeita uma proposta. 409 se ela já foi decidida ou o evento mudou desde então. */
export async function POST(request: Request, { params }: { params: Promise<{ approvalId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "SESSION_EXPIRED" }, { status: 401 });
  }
  const { approvalId } = await params;
  const body = await readJsonBody(request, ReviewDecisionSchema);
  if (!body.ok) return body.response;

  try {
    const approval = await decideProposal({
      reviewerId: session.user.id,
      approvalId,
      decision: body.data.decision,
      notes: body.data.notes,
    });
    return NextResponse.json({ approval });
  } catch (err) {
    const response = domainErrorResponse(err);
    if (response) return response;
    throw err;
  }
}
