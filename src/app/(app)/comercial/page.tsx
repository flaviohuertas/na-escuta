import { AppLink } from "@/components/ui/AppLink";
import { OpportunityCardLink, PipelineBoard, crmErrorView } from "@/components/crm/CrmParts";
import { requireSession } from "@/lib/auth/require-session";
import { formatBRL, formatDateBR } from "@/lib/domain/crm";
import { listPipeline } from "@/server/crm/opportunity.service";
import { buttonClass } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";

/**
 * O funil comercial — Server Component ao vivo (exige conexão, como o catálogo de eventos e o Painel).
 * Cada coluna soma o valor estimado de TODAS as oportunidades da etapa, mesmo que mostre só as primeiras.
 */
export default async function CommercialPage() {
  const session = await requireSession();
  let pipeline: Awaited<ReturnType<typeof listPipeline>>;
  try {
    pipeline = await listPipeline({ userId: session.user.id, companyId: session.user.companyId });
  } catch (err) {
    return crmErrorView(err);
  }

  const openTotal = pipeline.columns.reduce((sum, column) => sum + column.totalCents, 0);
  const openCount = pipeline.columns.reduce((sum, column) => sum + column.count, 0);

  return (
    <div className="max-w-7xl">
      {/* As ações quebram de linha INTEIRAS (flex-wrap do PageHeader): no celular, "Nova oportunidade"
          desce para a linha de baixo em vez de quebrar o texto dentro do botão. */}
      <PageHeader
        title="Comercial"
        description={`${openCount} oportunidade${openCount === 1 ? "" : "s"} em andamento · ${formatBRL(openTotal)} estimados`}
        actions={
          <>
            <AppLink href="/comercial/propostas" className={buttonClass({ variant: "secondary" })}>
              Propostas
            </AppLink>
            <AppLink href="/comercial/clientes" className={buttonClass({ variant: "secondary" })}>
              Clientes
            </AppLink>
            <AppLink href="/comercial/oportunidades/nova" className={buttonClass()}>
              Nova oportunidade
            </AppLink>
          </>
        }
      />

      {pipeline.truncated && (
        <p role="status" className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Há mais oportunidades em andamento do que a tela mostra. As contagens e os valores de cada etapa somam todas.
        </p>
      )}

      <PipelineBoard columns={pipeline.columns} />

      <div className="mt-8 grid gap-4 md:grid-cols-2">
        {(
          [
            ["Ganhas recentemente", pipeline.won, "won"],
            ["Perdidas recentemente", pipeline.lost, "lost"],
          ] as const
        ).map(([title, cards, key]) => (
          <details key={key} className="rounded-xl border border-line bg-white p-3" data-testid={`closed-${key}`}>
            <summary className="-m-3 flex min-h-11 cursor-pointer items-center gap-2 rounded-xl p-3 text-sm font-semibold text-slate-800 hover:bg-slate-50">
              {title} ({cards.length})
            </summary>
            <ul className="mt-6 space-y-2">
              {cards.map((card) => (
                <li key={card.id}>
                  <OpportunityCardLink card={card} />
                  {card.closedAt && <p className="mt-0.5 text-xs text-slate-400">Encerrada em {formatDateBR(card.closedAt)}</p>}
                </li>
              ))}
              {cards.length === 0 && <li className="text-xs text-slate-400">Nenhuma.</li>}
            </ul>
          </details>
        ))}
      </div>
    </div>
  );
}
