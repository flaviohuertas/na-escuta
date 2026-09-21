import { AppLink } from "@/components/ui/AppLink";
import { financeErrorView } from "@/components/finance/FinanceParts";
import { requireSession } from "@/lib/auth/require-session";
import { formatBps } from "@/lib/domain/budget";
import { formatBRL, formatDateBR } from "@/lib/domain/crm";
import { EVENT_STATUS_LABEL } from "@/lib/domain/event-labels";
import type { EventStatus } from "@/lib/domain/event.schema";
import { listFinanceOverview } from "@/server/finance/finance.service";

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
      <div className="mx-auto max-w-4xl">
        <h1 className="text-2xl font-semibold text-slate-900">Financeiro</h1>
        <p className="mt-4 text-slate-500">Nenhum evento ainda.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-semibold text-slate-900">Financeiro</h1>
      <p className="mt-1 text-sm text-slate-500">
        O custo realizado de cada evento, contra o orçamento previsto quando o evento nasceu de uma oportunidade. Só titular e administração veem esta área.
      </p>
      <ul className="mt-6 space-y-2">
        {overview.rows.map((row) => (
          <li key={row.eventId}>
            <AppLink
              href={`/financeiro/eventos/${row.eventId}`}
              className="block rounded-lg border border-slate-200 bg-white p-4 shadow-sm hover:border-brand-300 hover:shadow"
              data-testid="finance-event-row"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-slate-900">{row.name}</span>
                <span className="text-xs text-slate-500">
                  {EVENT_STATUS_LABEL[row.status as EventStatus] ?? row.status} · {formatDateBR(row.startDate)}
                </span>
              </div>
              <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-xs text-slate-500">Previsto</dt>
                  <dd className="tabular-nums" data-testid="row-planned">
                    {row.plannedCents !== null ? formatBRL(row.plannedCents) : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Lançado ({row.expenseCount})</dt>
                  <dd className="tabular-nums" data-testid="row-realized">
                    {formatBRL(row.realizedCents)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Receita</dt>
                  <dd className="tabular-nums">{row.revenue ? formatBRL(row.revenue.cents) : "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Margem até agora</dt>
                  <dd className={`tabular-nums ${row.realizedMargin && row.realizedMargin.marginCents < 0 ? "font-medium text-red-700" : ""}`} data-testid="row-margin">
                    {row.realizedMargin
                      ? `${formatBRL(row.realizedMargin.marginCents)}${row.realizedMargin.marginBps !== null ? ` (${formatBps(row.realizedMargin.marginBps)})` : ""}`
                      : "—"}
                  </dd>
                </div>
              </dl>
            </AppLink>
          </li>
        ))}
      </ul>
      {overview.truncated && (
        <p role="status" className="mt-3 text-sm text-amber-800">
          Mostrando os 200 eventos mais recentes.
        </p>
      )}
    </div>
  );
}
