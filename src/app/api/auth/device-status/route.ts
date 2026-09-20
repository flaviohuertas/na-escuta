import { NextResponse } from "next/server";
import { z } from "zod";
import { evaluateDeviceGrant, InvalidGrantError } from "@/server/auth/device-status.service";

const BodySchema = z.object({ jwt: z.string().min(1).max(4096) });

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * PÚBLICA de propósito — não usa a sessão web: quem perdeu o vínculo não a tem mais, e é
 * exatamente esse aparelho que precisa saber. A "credencial" é o grant offline (JWT EdDSA que só o
 * servidor assina); sem um grant autêntico não há resposta. Só diz se aquele aparelho/pessoa ainda
 * vale — não devolve dado de empresa, evento ou usuário.
 *
 * `401 { status: "invalid" }` para grant que não é nosso. O cliente trata isso como "não sei" e
 * NUNCA apaga nada por causa dele: só um veredito `revoked` assinado por esta rota apaga.
 */
export async function POST(request: Request) {
  const body = BodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ status: "invalid" }, { status: 400, headers: NO_STORE });
  }

  try {
    return NextResponse.json(await evaluateDeviceGrant(body.data.jwt), { headers: NO_STORE });
  } catch (err) {
    if (err instanceof InvalidGrantError) {
      return NextResponse.json({ status: "invalid" }, { status: 401, headers: NO_STORE });
    }
    throw err;
  }
}
