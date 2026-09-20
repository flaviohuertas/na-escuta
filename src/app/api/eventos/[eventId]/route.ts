import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth.config";
import { EventUpdateInputSchema } from "@/lib/domain/event.schema";
import { updateEvent } from "@/server/events/event.service";
import { domainErrorResponse, validationErrorResponse } from "@/server/http/responses";

/** Edita os dados do evento (só o gestor dele). Exige conexão. */
export async function PATCH(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "SESSION_EXPIRED" }, { status: 401 });
  }

  const { eventId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = EventUpdateInputSchema.safeParse(body);
  if (!parsed.success) return validationErrorResponse(parsed.error);

  try {
    const event = await updateEvent({ userId: session.user.id, eventId, input: parsed.data });
    return NextResponse.json({ event });
  } catch (err) {
    const response = domainErrorResponse(err);
    if (response) return response;
    throw err;
  }
}
