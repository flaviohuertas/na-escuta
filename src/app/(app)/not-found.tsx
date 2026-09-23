import { AppLink } from "@/components/ui/AppLink";
import { buttonClass } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";

/** `notFound()` dentro do app: o item não existe (ou saiu do alcance da pessoa). O menu continua na tela. */
export default function AppNotFound() {
  return (
    <div className="max-w-xl">
      <title>Não encontrado · Na Escuta</title>
      <PageHeader
        title="Não encontramos este item"
        description="Ele pode ter sido arquivado, ou o seu acesso a ele mudou."
      />
      <AppLink href="/eventos" className={buttonClass({ variant: "secondary", className: "mt-6" })}>
        Ir para os eventos
      </AppLink>
    </div>
  );
}
