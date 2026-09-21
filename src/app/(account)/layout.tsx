import { redirect } from "next/navigation";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { AppLink } from "@/components/ui/AppLink";
import { LogoMark, Wordmark } from "@/components/ui/Logo";
import { auth } from "@/lib/auth/auth.config";

/**
 * Telas da conta (trocar a senha). FORA do shell do app de propósito: quem entrou com senha
 * provisória só chega até aqui — o shell de `(app)` o manda para cá e, se esta tela morasse
 * lá dentro, o redirecionamento entraria em laço. Sem menu, sem sincronização.
 */
export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between gap-3 bg-ink px-4 py-3 text-white">
        <AppLink href="/eventos" className="flex items-center gap-2.5">
          <LogoMark size={32} tile="soft" />
          <Wordmark className="text-lg" />
        </AppLink>
        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-ink-muted sm:block">{session.user.name}</span>
          <LogoutButton />
        </div>
      </header>
      <main className="mx-auto w-full max-w-md flex-1 p-4 md:p-6">{children}</main>
    </div>
  );
}
