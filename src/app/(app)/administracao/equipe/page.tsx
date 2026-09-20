import { AppLink } from "@/components/ui/AppLink";
import { TeamManager } from "@/components/admin/TeamManager";
import { requireSession } from "@/lib/auth/require-session";
import { AdminActionError } from "@/server/errors";
import { listTeam } from "@/server/team/team.service";

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
        <div className="mx-auto max-w-3xl">
          <h1 className="text-2xl font-semibold text-slate-900">Equipe</h1>
          <div className="mt-4 rounded-md bg-slate-100 px-4 py-3 text-sm text-slate-700">
            <p>{err.message}</p>
            <AppLink href="/eventos" className="mt-3 inline-block font-medium text-brand-700 hover:underline">
              Voltar aos eventos
            </AppLink>
          </div>
        </div>
      );
    }
    throw err;
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold text-slate-900">Equipe</h1>
      <p className="mt-1 text-sm text-slate-500">
        Quem faz parte da empresa e com qual papel. O acesso a cada evento se dá na tela “Pessoas” do próprio evento.
      </p>
      <TeamManager
        members={data.members.map((m) => ({
          membershipId: m.membershipId,
          name: m.name,
          email: m.email,
          role: m.role,
          status: m.status,
          mustChangePassword: m.mustChangePassword,
          isSelf: m.isSelf,
          canModify: m.canModify,
        }))}
        assignableRoles={data.assignableRoles}
      />
    </div>
  );
}
