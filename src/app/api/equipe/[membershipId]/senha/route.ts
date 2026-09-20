import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth.config";
import { domainErrorResponse } from "@/server/http/responses";
import { resetMemberPassword } from "@/server/team/team.service";

/** Redefine a senha de alguém da equipe: nova senha PROVISÓRIA, devolvida UMA vez. */
export async function POST(_request: Request, { params }: { params: Promise<{ membershipId: string }> }) {
  const session = await auth();
  if (!session?.user?.id || !session.user.companyId) {
    return NextResponse.json({ error: "SESSION_EXPIRED" }, { status: 401 });
  }
  const { membershipId } = await params;

  try {
    const result = await resetMemberPassword({
      actorId: session.user.id,
      companyId: session.user.companyId,
      membershipId,
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const response = domainErrorResponse(err);
    if (response) return response;
    throw err;
  }
}
