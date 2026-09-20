import { AppLink } from "@/components/ui/AppLink";
import { LogoutButton } from "@/components/auth/LogoutButton";

export function AppNav({
  userName,
  canManageTeam = false,
  pendingApprovals = 0,
}: {
  userName: string;
  canManageTeam?: boolean;
  /** Propostas esperando a decisão desta pessoa. */
  pendingApprovals?: number;
}) {
  return (
    <nav className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-900 px-4 py-3 text-white md:w-56 md:flex-col md:items-stretch md:border-b-0 md:border-r">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 md:flex-col md:items-stretch md:gap-1">
        <AppLink href="/eventos" className="font-semibold">
          Na Escuta
        </AppLink>
        <AppLink href="/painel" className="text-sm text-slate-300 hover:text-white">
          Painel
        </AppLink>
        <AppLink href="/eventos" className="text-sm text-slate-300 hover:text-white">
          Eventos
        </AppLink>
        <AppLink href="/aprovacoes" className="text-sm text-slate-300 hover:text-white">
          Aprovações
          {pendingApprovals > 0 && (
            <span
              className="ml-1.5 rounded-full bg-amber-400 px-1.5 py-0.5 text-xs font-semibold text-slate-900"
              aria-label={`${pendingApprovals} aguardando sua decisão`}
            >
              {pendingApprovals}
            </span>
          )}
        </AppLink>
        <AppLink href="/conflitos" className="text-sm text-slate-300 hover:text-white">
          Conflitos
        </AppLink>
        <AppLink href="/configuracoes/sincronizacao" className="text-sm text-slate-300 hover:text-white">
          Sincronização
        </AppLink>
        {canManageTeam && (
          <AppLink href="/administracao/equipe" className="text-sm text-slate-300 hover:text-white">
            Equipe
          </AppLink>
        )}
      </div>
      <div className="flex items-center gap-2 md:mt-auto md:flex-col md:items-stretch md:pt-4">
        <span className="hidden text-xs text-slate-400 md:block">{userName}</span>
        <AppLink href="/trocar-senha" className="text-xs text-slate-400 hover:text-white">
          Trocar senha
        </AppLink>
        <LogoutButton />
      </div>
    </nav>
  );
}
