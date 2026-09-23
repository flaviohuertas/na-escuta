import { AppLink } from "@/components/ui/AppLink";
import { buttonClass } from "@/components/ui/Button";
import { LogoMark, Wordmark } from "@/components/ui/Logo";

/**
 * Endereço que não existe. Fica fora do app (sem menu), então usa a mesma moldura do login e
 * sempre oferece o caminho de volta: `/` leva aos eventos, ou ao login de quem não entrou.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4 py-8">
      <title>Página não encontrada · Na Escuta</title>
      <div className="flex items-center gap-3">
        <LogoMark size={40} />
        <Wordmark className="text-3xl" />
      </div>
      <div className="w-full max-w-sm rounded-xl border border-line bg-white p-6">
        <h1 className="text-2xl text-slate-900">Página não encontrada</h1>
        <p className="mt-2 text-sm text-slate-600">
          O endereço pode estar errado ou a página mudou de lugar.
        </p>
        <AppLink href="/" className={buttonClass({ className: "mt-6 w-full" })}>
          Ir para os eventos
        </AppLink>
      </div>
    </main>
  );
}
