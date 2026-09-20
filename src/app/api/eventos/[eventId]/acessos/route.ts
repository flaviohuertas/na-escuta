import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth.config";
import { GrantEventAccessSchema } from "@/lib/domain/access.schema";
import { grantEventAccess } from "@/server/events/event-access.service";
import { domainErrorResponse, readJsonBody } from "@/server/http/responses";

/** Dá acesso ao evento a alguém da empresa (só o gestor do evento). Exige conexão. */
export async function POST(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "SESSION_EXPIRED" }, { status: 401 });

  const { eventId } = await params;
  const body = await readJsonBody(request, GrantEventAccessSchema);
  if (!body.ok) return body.response;

  try {
    const access = await grantEventAccess({
      actorId: session.user.id,
      eventId,
      userId: body.data.userId,
      role: body.data.role,
    });
    return NextResponse.json({ access }, { status: 201 });
  } catch (err) {
    const response = domainErrorResponse(err);
    if (response) return response;
    throw err;
  }
}
