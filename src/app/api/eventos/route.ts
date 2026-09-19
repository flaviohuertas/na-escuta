import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth.config";
import { EventInputSchema } from "@/lib/domain/event.schema";
import { createEvent } from "@/server/events/event.service";
import { eventErrorResponse, validationErrorResponse } from "@/server/events/event-http";

/** Cria um evento na empresa da sessão. Exige conexão (é uma ação de gestão, não de campo). */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id || !session.user.companyId) {
    return NextResponse.json({ error: "SESSION_EXPIRED" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = EventInputSchema.safeParse(body);
  if (!parsed.success) return validationErrorResponse(parsed.error);

  try {
    const event = await createEvent({
      userId: session.user.id,
      companyId: session.user.companyId,
      input: parsed.data,
    });
    return NextResponse.json({ event }, { status: 201 });
  } catch (err) {
    const response = eventErrorResponse(err);
    if (response) return response;
    throw err;
  }
}
