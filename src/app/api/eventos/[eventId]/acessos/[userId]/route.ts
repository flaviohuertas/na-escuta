import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth.config";
import { ChangeEventAccessSchema } from "@/lib/domain/access.schema";
import { changeEventAccess } from "@/server/events/event-access.service";
import { domainErrorResponse, readJsonBody } from "@/server/http/responses";

/** Muda o papel de alguém no evento, ou revoga/reativa o acesso (só o gestor do evento). Exige conexão. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ eventId: string; userId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "SESSION_EXPIRED" }, { status: 401 });

  const { eventId, userId } = await params;
  const body = await readJsonBody(request, ChangeEventAccessSchema);
  if (!body.ok) return body.response;

  try {
    const access = await changeEventAccess({
      actorId: session.user.id,
      eventId,
      userId,
      role: body.data.role,
      status: body.data.status,
    });
    return NextResponse.json({ access });
  } catch (err) {
    const response = domainErrorResponse(err);
    if (response) return response;
    throw err;
  }
}
