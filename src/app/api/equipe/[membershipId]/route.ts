import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth.config";
import { ChangeMemberSchema } from "@/lib/domain/team.schema";
import { domainErrorResponse, readJsonBody } from "@/server/http/responses";
import { changeMember } from "@/server/team/team.service";

/** Muda o papel de alguém na empresa e/ou encerra/reativa o vínculo (titular/administração). */
export async function PATCH(request: Request, { params }: { params: Promise<{ membershipId: string }> }) {
  const session = await auth();
  if (!session?.user?.id || !session.user.companyId) {
    return NextResponse.json({ error: "SESSION_EXPIRED" }, { status: 401 });
  }
  const { membershipId } = await params;
  const body = await readJsonBody(request, ChangeMemberSchema);
  if (!body.ok) return body.response;

  try {
    const membership = await changeMember({
      actorId: session.user.id,
      companyId: session.user.companyId,
      membershipId,
      role: body.data.role,
      status: body.data.status,
    });
    return NextResponse.json({ membership });
  } catch (err) {
    const response = domainErrorResponse(err);
    if (response) return response;
    throw err;
  }
}
