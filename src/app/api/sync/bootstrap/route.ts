import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth.config";
import { bootstrapEvent, EventAccessDeniedError } from "@/server/sync/bootstrap.service";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "SESSION_EXPIRED" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const eventId = searchParams.get("eventId");
  if (!eventId) {
    return NextResponse.json({ error: "eventId é obrigatório." }, { status: 400 });
  }

  try {
    const response = await bootstrapEvent(eventId, { userId: session.user.id });
    return NextResponse.json(response);
  } catch (err) {
    if (err instanceof EventAccessDeniedError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    throw err;
  }
}
