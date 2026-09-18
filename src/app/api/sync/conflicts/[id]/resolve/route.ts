import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth/auth.config";
import {
  ConflictAlreadyResolvedError,
  ConflictForbiddenError,
  ConflictNotFoundError,
  resolveConflict,
} from "@/server/sync/conflict.service";

const BodySchema = z.object({
  strategy: z.enum(["KEEP_SERVER", "KEEP_CLIENT", "MERGED"]),
  mergedPayload: z.record(z.string(), z.unknown()).optional(),
  resolutionNotes: z.string().max(2000).optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "SESSION_EXPIRED" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload inválido." }, { status: 400 });
  }

  try {
    const entity = await resolveConflict({
      conflictId: id,
      userId: session.user.id,
      strategy: parsed.data.strategy,
      mergedPayload: parsed.data.mergedPayload,
      resolutionNotes: parsed.data.resolutionNotes,
    });
    return NextResponse.json({ entity });
  } catch (err) {
    if (err instanceof ConflictNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof ConflictAlreadyResolvedError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof ConflictForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    throw err;
  }
}
