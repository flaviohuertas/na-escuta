import { redirect } from "next/navigation";
import { auth } from "./auth.config";

export interface SessionWithCompany {
  user: {
    id: string;
    email: string;
    name: string;
    companyId: string;
  };
}

/**
 * O layout de (app) já redireciona sessões inválidas para /login, mas cada
 * Server Component que chama auth() faz sua PRÓPRIA leitura da sessão — não
 * há garantia implícita de que o resultado aqui é não-nulo só porque o
 * layout pai também checou. Toda página que precisa de `session.user` deve
 * usar este helper em vez de `auth()` + `!` direto.
 */
export async function requireSession(): Promise<SessionWithCompany> {
  const session = await auth();
  if (!session?.user?.id || !session.user.companyId) {
    redirect("/login");
  }
  return session as SessionWithCompany;
}
