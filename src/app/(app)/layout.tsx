import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/auth.config";
import { SyncProvider } from "@/components/providers/SyncProvider";
import { SyncStatusBar } from "@/components/sync/SyncStatusBar";
import { AppNav } from "@/components/layout/AppNav";
import { prisma } from "@/lib/db/prisma";
import { canManageCrm, canManageFinance, canManageMembers, canManageSuppliers } from "@/lib/domain/permissions";
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
      {/* Desktop: barra lateral em altura total + coluna do conteúdo. Celular: a barra de abas fica
          fixa embaixo (o `pb-28` do conteúdo a deixa livre) e o menu completo abre em "Mais". */}
      <div className="min-h-dvh md:flex">
        <AppNav
          userName={session.user.name}
          canManageTeam={companyRole !== null && canManageMembers(companyRole)}
          canManageCrm={companyRole !== null && canManageCrm(companyRole)}
          canManageFinance={companyRole !== null && canManageFinance(companyRole)}
          canManageSuppliers={companyRole !== null && canManageSuppliers(companyRole)}
          pendingApprovals={pendingApprovals}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <SyncStatusBar />
          <main className="flex-1 p-4 pb-28 md:p-8">{children}</main>
        </div>
      </div>
    </SyncProvider>
  );
}
