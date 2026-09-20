import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/db/prisma";
import { AccessStatus } from "@/generated/prisma/enums";
import { authenticateCredentials } from "@/server/auth/credentials";
import { isSessionCurrent, readSessionVersion } from "@/server/auth/session-version";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      companyId: string | null;
    };
  }
}

type AppJwt = Record<string, unknown> & {
  userId?: string;
  companyId?: string | null;
  /** `User.sessionVersion` no momento do login; ver `server/auth/session-version.ts`. */
  sessionVersion?: number;
};

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "E-mail", type: "email" },
        password: { label: "Senha", type: "password" },
      },
      // A regra (e-mail normalizado, conta ativa, senha) mora em `authenticateCredentials`, onde dá para testá-la.
      authorize: (rawCredentials) => authenticateCredentials(rawCredentials),
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      const t = token as AppJwt;
      if (user?.id) {
        t.userId = user.id;
        t.sessionVersion = (await readSessionVersion(user.id)) ?? 0;
        const membership = await prisma.membership.findFirst({
          where: { userId: user.id, status: AccessStatus.ACTIVE },
          orderBy: { createdAt: "asc" },
        });
        t.companyId = membership?.companyId ?? null;
        return t;
      }
      // Toda leitura de sessão passa por aqui (`auth()` em páginas e rotas): conta desativada ou
      // versão mudada (senha redefinida, vínculo encerrado) → `null` derruba a sessão e limpa o cookie.
      return (await isSessionCurrent(t.userId, t.sessionVersion)) ? t : null;
    },
    async session({ session, token }) {
      const t = token as AppJwt;
      if (typeof t.userId === "string") {
        session.user.id = t.userId;
        session.user.companyId = t.companyId ?? null;
      }
      return session;
    },
  },
});
