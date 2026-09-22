import { NextResponse } from "next/server";
import { auth, signIn } from "@/lib/auth/auth.config";
import { ChangePasswordSchema } from "@/lib/domain/password.schema";
import { passwordChangeRateLimiter } from "@/server/auth/rate-limit";
import { changeOwnPassword } from "@/server/auth/password";
import { AdminActionError } from "@/server/errors";
import { domainErrorResponse, readJsonBody } from "@/server/http/responses";

/**
 * A pessoa troca a PRÓPRIA senha (exige a atual). Também tira a marca de "troca obrigatória" e
 * derruba as sessões abertas dela — inclusive esta, que é reemitida logo abaixo.
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "SESSION_EXPIRED" }, { status: 401 });
  }

  const rateLimit = passwordChangeRateLimiter.beforeRequest(session.user.id);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Muitas tentativas seguidas. Tente novamente em alguns minutos." },
      { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(Math.ceil((rateLimit.retryAfterMs ?? 0) / 1000)) } }
    );
  }

  const body = await readJsonBody(request, ChangePasswordSchema);
  if (!body.ok) return body.response;

  try {
    const { email } = await changeOwnPassword(session.user.id, body.data);
    passwordChangeRateLimiter.recordSuccess(session.user.id);

    // A troca subiu a versão das sessões e o cookie desta requisição ficou velho. Sem reemiti-lo, a
    // pessoa seria deslogada no meio do que estava fazendo. Se falhar, a troca já valeu e a única
    // consequência é entrar de novo com a senha nova: a próxima tela redireciona para o login.
    try {
      await signIn("credentials", { email, password: body.data.newPassword, redirect: false });
    } catch (err) {
      console.error("Senha trocada, mas a sessão atual não pôde ser reemitida", err);
    }

    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof AdminActionError) {
      passwordChangeRateLimiter.recordFailure(session.user.id);
    }
    const response = domainErrorResponse(err);
    if (response) return response;
    throw err;
  }
}
