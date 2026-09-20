import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth.config";
import { AddMemberSchema } from "@/lib/domain/team.schema";
import { domainErrorResponse, readJsonBody } from "@/server/http/responses";
import { addMember } from "@/server/team/team.service";

/** Cadastra uma pessoa na equipe (titular/administração). Devolve a senha provisória UMA vez. */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id || !session.user.companyId) {
    return NextResponse.json({ error: "SESSION_EXPIRED" }, { status: 401 });
  }
  const body = await readJsonBody(request, AddMemberSchema);
  if (!body.ok) return body.response;

  try {
    const result = await addMember({
      actorId: session.user.id,
      companyId: session.user.companyId,
      ...body.data,
    });
    return NextResponse.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const response = domainErrorResponse(err);
    if (response) return response;
    throw err;
  }
}
