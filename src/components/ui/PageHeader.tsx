import type { ReactNode } from "react";
import { AppLink } from "@/components/ui/AppLink";
import { Icon } from "@/components/ui/Icon";

/** Voltar para a tela de cima. Tem 44 px de altura e o ícone é decorativo: o nome é só o texto. */
export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <AppLink
      href={href}
      className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-brand-700 hover:bg-brand-50"
    >
      <Icon name="voltar" size={18} />
      {children}
    </AppLink>
  );
}

/**
 * O topo de uma tela: voltar, título (`h1`), uma linha de apoio e, à direita, o que vale para a tela
 * toda (um selo, um botão). Um só tamanho de título em todo o app.
 */
export function PageHeader({
  title,
  description,
  back,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  back?: { href: string; label: string };
  actions?: ReactNode;
}) {
  return (
    <header>
      {back && <BackLink href={back.href}>{back.label}</BackLink>}
      <div className={`flex flex-wrap items-start justify-between gap-3 ${back ? "mt-1" : ""}`}>
        <div className="min-w-0">
          <h1 className="text-2xl text-slate-900 [overflow-wrap:anywhere]">{title}</h1>
          {description && <p className="mt-1 text-sm text-slate-600">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
