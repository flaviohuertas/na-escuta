import { AppLink } from "@/components/ui/AppLink";
import { TeamManager } from "@/components/admin/TeamManager";
import { requireSession } from "@/lib/auth/require-session";
import { AdminActionError } from "@/server/errors";
import { listTeam } from "@/server/team/team.service";
import { PageHeader } from "@/components/ui/PageHeader";
import { buttonClass } from "@/components/ui/Button";

/**
 * Renderizada no servidor e FORA do cache do Service Worker: a lista da equipe é informação ao
 * vivo e toda ação aqui exige conexão. Só titular e administração abrem; o papel é lido do banco.
 */
export default async function TeamPage() {
  const session = await requireSession();

  let data: Awaited<ReturnType<typeof listTeam>>;
  try {
    data = await listTeam({ actorId: session.user.id, companyId: session.user.companyId });
  } catch (err) {
    if (err instanceof AdminActionError) {
      return (
        <div className="max-w-3xl">
          <PageHeader title="Equipe" description={err.message} />
          <AppLink href="/eventos" className={buttonClass({ variant: "secondary", className: "mt-6" })}>
            Voltar aos eventos
          </AppLink>
        </div>
      );
    }
    throw err;
  }

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Equipe"
        description="Quem faz parte da empresa e com qual papel. O acesso a cada evento se dá na tela “Pessoas” do próprio evento."
      />
      <TeamManager
        members={data.members.map((m) => ({
          membershipId: m.membershipId,
          name: m.name,
          email: m.email,
          role: m.role,
          status: m.status,
          isActive: m.isActive,
          mustChangePassword: m.mustChangePassword,
          isSelf: m.isSelf,
          canModify: m.canModify,
        }))}
        assignableRoles={data.assignableRoles}
      />
    </div>
  );
}
