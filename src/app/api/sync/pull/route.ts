import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth.config";
import { pullChangesForEvent } from "@/server/sync/pull.service";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "SESSION_EXPIRED" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const eventId = searchParams.get("eventId");
  const cursor = searchParams.get("cursor");
  if (!eventId) {
    return NextResponse.json({ error: "eventId é obrigatório." }, { status: 400 });
  }

  const response = await pullChangesForEvent(eventId, cursor, { userId: session.user.id });
  return NextResponse.json(response);
}
