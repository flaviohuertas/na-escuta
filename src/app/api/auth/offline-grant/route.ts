import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth/auth.config";
import { issueOfflineGrant } from "@/server/auth/offline-grant.service";

const BodySchema = z.object({
  deviceId: z.string().min(1),
  deviceLabel: z.string().max(120).optional(),
});

/**
 * Só pode ser chamado com uma sessão web já autenticada (cookie do Auth.js).
 * O grant emitido aqui NUNCA é usado para autorizar escrita no servidor — só
 * autoriza o app a abrir e operar localmente enquanto offline.
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id || !session.user.companyId) {
    return NextResponse.json(
      { error: "Sessão inválida ou usuário sem empresa ativa." },
      { status: 401 }
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload inválido." }, { status: 400 });
  }

  try {
    const grant = await issueOfflineGrant({
      userId: session.user.id,
      companyId: session.user.companyId,
      deviceId: parsed.data.deviceId,
      deviceLabel: parsed.data.deviceLabel,
    });
    return NextResponse.json(grant);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Falha ao emitir grant offline." },
      { status: 403 }
    );
  }
}
