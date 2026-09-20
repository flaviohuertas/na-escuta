import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/auth.config";
import { SyncProvider } from "@/components/providers/SyncProvider";
import { SyncStatusBar } from "@/components/sync/SyncStatusBar";
import { AppNav } from "@/components/layout/AppNav";
import { prisma } from "@/lib/db/prisma";
import { canManageMembers } from "@/lib/domain/permissions";
import { countPendingForReview } from "@/server/approvals/approval.service";
import { getActiveCompanyRole } from "@/server/auth/membership";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  // Lidos do BANCO a cada carga do shell (o JWT da sessão não muda quando o papel muda).
  const [account, companyRole, pendingApprovals] = await Promise.all([
    prisma.user.findUnique({ where: { id: session.user.id }, select: { mustChangePassword: true } }),
    session.user.companyId ? getActiveCompanyRole(session.user.id, session.user.companyId) : null,
    countPendingForReview(session.user.id),
  ]);

  // Senha provisória: nada do app abre antes de a pessoa criar a própria. A tela de troca fica
  // FORA deste layout (grupo `(account)`), senão o redirecionamento entraria em laço.
  if (account?.mustChangePassword) redirect("/trocar-senha");

  return (
    <SyncProvider userId={session.user.id}>
      <div className="flex min-h-dvh flex-col">
        <SyncStatusBar />
        <div className="flex flex-1 flex-col md:flex-row">
          <AppNav
            userName={session.user.name}
            canManageTeam={companyRole !== null && canManageMembers(companyRole)}
            pendingApprovals={pendingApprovals}
          />
          <main className="flex-1 p-4 md:p-6">{children}</main>
        </div>
      </div>
    </SyncProvider>
  );
}
