import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth.config";
import { ConflictForbiddenError, listPendingConflicts } from "@/server/sync/conflict.service";

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
    const conflicts = await listPendingConflicts(eventId, session.user.id);
    return NextResponse.json({ conflicts });
  } catch (err) {
    if (err instanceof ConflictForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    throw err;
  }
}
