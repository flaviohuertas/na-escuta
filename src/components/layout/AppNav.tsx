import Link from "next/link";
import { LogoutButton } from "@/components/auth/LogoutButton";

export function AppNav({ userName }: { userName: string }) {
  return (
    <nav className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-900 px-4 py-3 text-white md:w-56 md:flex-col md:items-stretch md:border-b-0 md:border-r">
      <div className="flex items-center gap-4 md:flex-col md:items-stretch md:gap-1">
        <Link href="/eventos" className="font-semibold">
          Na Escuta
        </Link>
        <Link href="/eventos" className="text-sm text-slate-300 hover:text-white">
          Eventos
        </Link>
        <Link href="/conflitos" className="text-sm text-slate-300 hover:text-white">
          Conflitos
        </Link>
        <Link href="/configuracoes/sincronizacao" className="text-sm text-slate-300 hover:text-white">
          Sincronização
        </Link>
      </div>
      <div className="flex items-center gap-2 md:mt-auto md:flex-col md:items-stretch md:pt-4">
        <span className="hidden text-xs text-slate-400 md:block">{userName}</span>
        <LogoutButton />
      </div>
    </nav>
  );
}
