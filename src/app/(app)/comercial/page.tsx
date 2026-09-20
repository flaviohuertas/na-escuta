import { AppLink } from "@/components/ui/AppLink";
import { OpportunityCardLink, PipelineBoard, crmErrorView } from "@/components/crm/CrmParts";
import { requireSession } from "@/lib/auth/require-session";
import { formatBRL, formatDateBR } from "@/lib/domain/crm";
import { listPipeline } from "@/server/crm/opportunity.service";

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
    <div className="mx-auto max-w-7xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Comercial</h1>
          <p className="mt-1 text-sm text-slate-500">
            {openCount} oportunidade{openCount === 1 ? "" : "s"} em andamento · {formatBRL(openTotal)} estimados
          </p>
        </div>
        <div className="flex gap-2">
          <AppLink href="/comercial/clientes" className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
            Clientes
          </AppLink>
          <AppLink href="/comercial/oportunidades/nova" className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
            Nova oportunidade
          </AppLink>
        </div>
      </div>

      {pipeline.truncated && (
        <p role="status" className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
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
          <details key={key} className="rounded-lg border border-slate-200 bg-white p-3" data-testid={`closed-${key}`}>
            <summary className="cursor-pointer text-sm font-semibold text-slate-800">
              {title} ({cards.length})
            </summary>
            <ul className="mt-3 space-y-2">
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
