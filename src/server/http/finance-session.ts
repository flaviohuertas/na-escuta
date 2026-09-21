import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth.config";

/**
 * A sessão das rotas do financeiro: quem está logado E a empresa dele. 401 sem sessão; 403 sem
 * empresa. Quem PODE mexer no financeiro é decidido pelo serviço, no banco, a cada chamada — isto
 * só entrega quem pergunta e sobre qual empresa.
 */
export async function financeSession(): Promise<
  { ok: true; userId: string; companyId: string } | { ok: false; response: NextResponse }
> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, response: NextResponse.json({ error: "SESSION_EXPIRED" }, { status: 401 }) };
  }
  if (!session.user.companyId) {
    return { ok: false, response: NextResponse.json({ error: "Você não tem acesso ao financeiro." }, { status: 403 }) };
  }
  return { ok: true, userId: session.user.id, companyId: session.user.companyId };
}
