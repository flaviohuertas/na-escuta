import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth.config";
import { ProposeEventChangeSchema } from "@/lib/domain/approval.schema";
import { proposeEventChange } from "@/server/approvals/approval.service";
import { domainErrorResponse, readJsonBody } from "@/server/http/responses";

/** A equipe de campo propõe uma correção nos dados do evento. Exige conexão (é uma ação de gestão, não de campo). */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "SESSION_EXPIRED" }, { status: 401 });
  }
  const body = await readJsonBody(request, ProposeEventChangeSchema);
  if (!body.ok) return body.response;

  try {
    const approval = await proposeEventChange({ userId: session.user.id, input: body.data });
    return NextResponse.json({ approval }, { status: 201 });
  } catch (err) {
    const response = domainErrorResponse(err);
    if (response) return response;
    throw err;
  }
}
