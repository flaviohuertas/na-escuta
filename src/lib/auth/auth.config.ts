import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { AccessStatus } from "@/generated/prisma/enums";

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
};

const CredentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

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
      async authorize(rawCredentials) {
        const parsed = CredentialsSchema.safeParse(rawCredentials);
        if (!parsed.success) return null;

        const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
        if (!user || !user.isActive) return null;

        const validPassword = await bcrypt.compare(parsed.data.password, user.passwordHash);
        if (!validPassword) return null;

        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      const t = token as AppJwt;
      if (user?.id) {
        t.userId = user.id;
        const membership = await prisma.membership.findFirst({
          where: { userId: user.id, status: AccessStatus.ACTIVE },
          orderBy: { createdAt: "asc" },
        });
        t.companyId = membership?.companyId ?? null;
      }
      return t;
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
