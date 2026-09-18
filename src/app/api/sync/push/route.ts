import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth.config";
import { PushRequestSchema } from "@/lib/sync/protocol";
import { processPushBatch } from "@/server/sync/push.service";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    // O cliente trata 401 como "sessão expirada" — outbox permanece intacta,
    // usuário precisa reautenticar online antes de sincronizar de novo.
    return NextResponse.json({ error: "SESSION_EXPIRED" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = PushRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Payload inválido.", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const results = await processPushBatch(parsed.data.operations, { userId: session.user.id });
  return NextResponse.json({ results, serverTime: new Date().toISOString() });
}
