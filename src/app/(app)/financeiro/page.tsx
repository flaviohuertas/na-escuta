import { AppLink } from "@/components/ui/AppLink";
import { financeErrorView } from "@/components/finance/FinanceParts";
import { cardClass } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { NoValue, Stat } from "@/components/ui/Stat";
import { requireSession } from "@/lib/auth/require-session";
import { formatBps } from "@/lib/domain/budget";
import { formatBRL, formatDateBR } from "@/lib/domain/crm";
import { EVENT_STATUS_LABEL } from "@/lib/domain/event-labels";
import type { EventStatus } from "@/lib/domain/event.schema";
import { listFinanceOverview } from "@/server/finance/finance.service";

const TITLE = "Financeiro";
const DESCRIPTION =
  "O custo realizado de cada evento, contra o orçamento previsto quando o evento nasceu de uma oportunidade. Só titular e administração veem esta área.";

/**
 * O financeiro: os eventos da empresa com o custo previsto, o lançado e a margem até agora. Só
 * titular e administração. Ao vivo (exige conexão) e fora do cache do Service Worker.
 */
export default async function FinancePage() {
  const session = await requireSession();
  let overview: Awaited<ReturnType<typeof listFinanceOverview>>;
  try {
    overview = await listFinanceOverview({ userId: session.user.id, companyId: session.user.companyId });
  } catch (err) {
    return financeErrorView(err);
  }
  if (overview.rows.length === 0) {
    return (
      <div className="max-w-4xl">
        <PageHeader title={TITLE} description={DESCRIPTION} />
        <div className="mt-6">
          <EmptyState hint="Os eventos aparecem aqui assim que são criados, direto ou a partir de uma oportunidade ganha.">
            Nenhum evento ainda.
          </EmptyState>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl">
      <PageHeader title={TITLE} description={DESCRIPTION} />
      <ul className="mt-6 space-y-3">
        {overview.rows.map((row) => {
          const margin = row.realizedMargin;
          return (
            <li key={row.eventId}>
              <AppLink
                href={`/financeiro/eventos/${row.eventId}`}
                className={cardClass({ interactive: true, className: "block" })}
                data-testid="finance-event-row"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-slate-900">{row.name}</span>
                  <span className="text-xs text-slate-500">
                    {EVENT_STATUS_LABEL[row.status as EventStatus] ?? row.status} · {formatDateBR(row.startDate)}
                  </span>
                </div>
                {/* A margem é o número que se procura aqui: vem primeiro e na cor do resultado. */}
                <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
                  <Stat
                    size="sm"
                    label="Margem até agora"
                    tone={!margin ? "neutral" : margin.marginCents < 0 ? "danger" : "success"}
                    valueTestId="row-margin"
                    value={
                      margin ? (
                        <>
                          {formatBRL(margin.marginCents)}
                          {margin.marginBps !== null && (
                            <span className="ml-1 font-sans text-xs font-semibold">({formatBps(margin.marginBps)})</span>
                          )}
                        </>
                      ) : (
                        <NoValue label="sem receita de referência" />
                      )
                    }
                  />
                  <Stat
                    size="sm"
                    label={`Lançado (${row.expenseCount})`}
                    valueTestId="row-realized"
                    value={formatBRL(row.realizedCents)}
                  />
                  <Stat
                    size="sm"
                    label="Previsto"
                    valueTestId="row-planned"
                    value={row.plannedCents !== null ? formatBRL(row.plannedCents) : <NoValue label="sem orçamento" />}
                  />
                  <Stat
                    size="sm"
                    label="Receita"
                    value={row.revenue ? formatBRL(row.revenue.cents) : <NoValue label="sem receita" />}
                  />
                </dl>
              </AppLink>
            </li>
          );
        })}
      </ul>
      {overview.truncated && (
        <p role="status" className="mt-3 text-sm text-amber-800">
          Mostrando os 200 eventos mais recentes.
        </p>
      )}
    </div>
  );
}
