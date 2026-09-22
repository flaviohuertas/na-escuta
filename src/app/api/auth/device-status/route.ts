import { NextResponse } from "next/server";
import { z } from "zod";
import { evaluateDeviceGrant, InvalidGrantError } from "@/server/auth/device-status.service";
import { deviceStatusRateLimiter, getClientIp } from "@/server/auth/rate-limit";

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
  const ip = getClientIp(request);
  const precheck = deviceStatusRateLimiter.beforeRequest(ip);
  if (!precheck.allowed) {
    return NextResponse.json({ status: "rate_limited" }, { status: 429, headers: { ...NO_STORE, "Retry-After": String(Math.ceil((precheck.retryAfterMs ?? 0) / 1000)) } });
  }

  const body = BodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    deviceStatusRateLimiter.recordFailure(ip);
    return NextResponse.json({ status: "invalid" }, { status: 400, headers: NO_STORE });
  }

  try {
    const verdict = await evaluateDeviceGrant(body.data.jwt);
    deviceStatusRateLimiter.recordSuccess(ip);
    return NextResponse.json(verdict, { headers: NO_STORE });
  } catch (err) {
    if (err instanceof InvalidGrantError) {
      deviceStatusRateLimiter.recordFailure(ip);
      return NextResponse.json({ status: "invalid" }, { status: 401, headers: NO_STORE });
    }
    throw err;
  }
}
