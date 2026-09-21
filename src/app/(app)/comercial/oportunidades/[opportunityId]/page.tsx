import { AppLink } from "@/components/ui/AppLink";
import { ConvertToEventForm } from "@/components/crm/ConvertToEventForm";
import { StageActions } from "@/components/crm/StageActions";
import { StageBadge, crmErrorView } from "@/components/crm/CrmParts";
import { MarginSummary } from "@/components/crm/BudgetParts";
import { ProposalVersionList } from "@/components/crm/ProposalParts";
import { requireSession } from "@/lib/auth/require-session";
import { formatBRL, formatDateBR } from "@/lib/domain/crm";
import { formatDateTimeBR } from "@/lib/domain/approval-format";
import { canManageFinance } from "@/lib/domain/permissions";
import { getActiveCompanyRole } from "@/server/auth/membership";
import { AdminActionError } from "@/server/errors";
import { getBudgetSummary } from "@/server/crm/budget.service";
import { getOpportunity } from "@/server/crm/opportunity.service";
import { listOpportunityProposals } from "@/server/crm/proposal.service";

/**
 * Uma oportunidade: dados, mover no funil, propostas, orçamento interno, transformar em evento e o
 * histórico. Ao vivo (exige conexão) e sem cache do Service Worker.
 */
export default async function OpportunityPage({ params }: { params: Promise<{ opportunityId: string }> }) {
  const session = await requireSession();
  const { opportunityId } = await params;

  const ctx = { userId: session.user.id, companyId: session.user.companyId };
  let data: Awaited<ReturnType<typeof getOpportunity>>;
  let proposals: Awaited<ReturnType<typeof listOpportunityProposals>>;
  let budget: Awaited<ReturnType<typeof getBudgetSummary>> | null;
  let companyRole: string | null;
  try {
    [data, proposals, budget, companyRole] = await Promise.all([
      getOpportunity({ ...ctx, opportunityId }),
      listOpportunityProposals({ ...ctx, opportunityId }),
      // Quem cuida do comercial mas não vê o orçamento (regra própria) simplesmente não vê a seção.
      getBudgetSummary({ ...ctx, opportunityId }).catch((err: unknown) => {
        if (err instanceof AdminActionError && err.status === 403) return null;
        throw err;
      }),
      getActiveCompanyRole(ctx.userId, ctx.companyId),
    ]);
  } catch (err) {
    return crmErrorView(err);
  }
  const { opportunity, client, owner, event, history } = data;
  const canConvert = !opportunity.eventId && opportunity.stage !== "LOST";
  const canCreateProposal = proposals.createBlockedReason === null && proposals.draftId === null;
  // O financeiro do evento é só de titular e administração: quem não vê nem o link recebe.
  const canSeeFinance = companyRole !== null && canManageFinance(companyRole);

  return (
    <div className="mx-auto max-w-3xl">
      <AppLink href="/comercial" className="text-sm text-slate-600 hover:text-slate-900">
        ← Funil
      </AppLink>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{opportunity.title}</h1>
          <p className="mt-1 text-sm text-slate-600">
            <AppLink href={`/comercial/clientes/${client.id}`} className="font-medium text-brand-700 hover:underline">
              {client.name}
            </AppLink>
            {client.archivedAt && <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-700">Cliente arquivado</span>}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <StageBadge stage={opportunity.stage} />
          <AppLink href={`/comercial/oportunidades/${opportunity.id}/editar`} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
            Editar
          </AppLink>
        </div>
      </div>

      <dl className="mt-5 grid gap-x-6 gap-y-3 rounded-lg border border-slate-200 bg-white p-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">Valor estimado</dt>
          <dd className="font-medium text-slate-900">{opportunity.expectedValueCents !== null ? formatBRL(opportunity.expectedValueCents) : "—"}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">Responsável</dt>
          <dd className="font-medium text-slate-900">{owner?.name ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">Início previsto</dt>
          <dd className="font-medium text-slate-900">{formatDateBR(opportunity.expectedStartDate)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">Término previsto</dt>
          <dd className="font-medium text-slate-900">{formatDateBR(opportunity.expectedEndDate)}</dd>
        </div>
        {opportunity.description && (
          <div className="sm:col-span-2">
            <dt className="text-xs uppercase tracking-wide text-slate-500">Descrição</dt>
            <dd className="whitespace-pre-line text-slate-800">{opportunity.description}</dd>
          </div>
        )}
        {opportunity.stage === "LOST" && opportunity.lostReason && (
          <div className="sm:col-span-2">
            <dt className="text-xs uppercase tracking-wide text-slate-500">Motivo da perda</dt>
            <dd className="text-slate-800">{opportunity.lostReason}</dd>
          </div>
        )}
      </dl>

      {event && (
        <p role="status" className="mt-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          Esta oportunidade virou o evento{" "}
          <AppLink href={`/eventos/${event.id}`} className="font-medium underline">
            {event.name}
          </AppLink>
          .
          {canSeeFinance && (
            <>
              {" "}
              <AppLink href={`/financeiro/eventos/${event.id}`} className="font-medium underline">
                Ver o financeiro do evento
              </AppLink>
              .
            </>
          )}
        </p>
      )}

      <StageActions opportunityId={opportunity.id} version={opportunity.version} stage={opportunity.stage} hasEvent={opportunity.eventId !== null} />

      <section aria-labelledby="proposals" className="mt-8" data-testid="proposals-section">
        <div className="flex items-center justify-between gap-2">
          <h2 id="proposals" className="text-lg font-semibold text-slate-900">
            Propostas
          </h2>
          {canCreateProposal && (
            <AppLink href={`/comercial/oportunidades/${opportunity.id}/propostas/nova`} className="text-sm font-medium text-brand-700 hover:underline">
              Nova proposta
            </AppLink>
          )}
        </div>
        {proposals.rows.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">{proposals.createBlockedReason ?? "Nenhuma proposta ainda. Monte os itens e a validade e marque como enviada quando mandar ao cliente."}</p>
        ) : (
          <>
            <ProposalVersionList rows={proposals.rows} />
            {proposals.draftId && proposals.createBlockedReason === null && (
              <p className="mt-2 text-xs text-slate-500">Há um rascunho em andamento: continue por ele ou descarte-o para criar outra proposta.</p>
            )}
          </>
        )}
      </section>

      {budget && (
        <section aria-labelledby="budget" className="mt-8" data-testid="budget-section">
          <div className="flex items-center justify-between gap-2">
            <h2 id="budget" className="text-lg font-semibold text-slate-900">
              Orçamento interno
            </h2>
            <AppLink href={`/comercial/oportunidades/${opportunity.id}/orcamento`} className="text-sm font-medium text-brand-700 hover:underline">
              {budget.budget ? "Abrir orçamento" : budget.blockedReason ? "Ver orçamento" : "Montar orçamento"}
            </AppLink>
          </div>
          <div className="mt-2">
            <MarginSummary totalCostCents={budget.totals.totalCents} revenue={budget.revenue} margin={budget.margin} hasBudget={budget.budget !== null} />
          </div>
        </section>
      )}

      {canConvert && (
        <details className="mt-6 rounded-lg border border-slate-200 bg-white p-4" data-testid="convert-section">
          <summary className="cursor-pointer text-sm font-semibold text-slate-800">Transformar em evento</summary>
          <p className="mt-2 text-sm text-slate-600">
            Cria o evento com os dados abaixo (você vira o gestor dele) e marca esta oportunidade como ganha.
          </p>
          <ConvertToEventForm
            opportunityId={opportunity.id}
            version={opportunity.version}
            initial={{
              name: opportunity.title,
              description: opportunity.description,
              startDate: opportunity.expectedStartDate?.toISOString() ?? null,
              endDate: opportunity.expectedEndDate?.toISOString() ?? null,
            }}
          />
        </details>
      )}

      <section aria-labelledby="history" className="mt-8">
        <h2 id="history" className="text-lg font-semibold text-slate-900">
          Histórico
        </h2>
        <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white text-sm">
          {history.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2" data-testid="history-entry">
              <span className="text-slate-800">{entry.text}</span>
              <span className="text-xs text-slate-500">
                {entry.actorName ?? "—"} · {formatDateTimeBR(entry.at.toISOString())}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
