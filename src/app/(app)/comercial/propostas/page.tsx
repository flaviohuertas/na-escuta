import { AppLink } from "@/components/ui/AppLink";
import { crmErrorView } from "@/components/crm/CrmParts";
import { ProposalStatusBadge } from "@/components/crm/ProposalParts";
import { requireSession } from "@/lib/auth/require-session";
import { formatBRL } from "@/lib/domain/crm";
import { PROPOSAL_STATUSES, PROPOSAL_STATUS_LABEL, formatDateOnlyBR, type ProposalStatusName } from "@/lib/domain/proposal";
import { listProposals } from "@/server/crm/proposal.service";
import { PageHeader } from "@/components/ui/PageHeader";

const FILTERS: Array<{ value: ProposalStatusName | "todas"; label: string }> = [
  { value: "SENT", label: "Enviadas" },
  { value: "DRAFT", label: "Rascunhos" },
  { value: "ACCEPTED", label: "Aceitas" },
  { value: "REJECTED", label: "Recusadas" },
  { value: "todas", label: "Todas" },
];

/**
 * As propostas da empresa. Por padrão as ENVIADAS, com as que vencem primeiro no topo — a lista de
 * quem está esperando resposta. Ao vivo; exige conexão.
 */
export default async function ProposalsPage({ searchParams }: { searchParams: Promise<{ situacao?: string }> }) {
  const session = await requireSession();
  const { situacao } = await searchParams;
  const status = situacao === "todas" ? undefined : ((PROPOSAL_STATUSES as readonly string[]).includes(situacao ?? "") ? (situacao as ProposalStatusName) : "SENT");
  const active = status ?? "todas";

  let data: Awaited<ReturnType<typeof listProposals>>;
  try {
    data = await listProposals({ userId: session.user.id, companyId: session.user.companyId, status });
  } catch (err) {
    return crmErrorView(err);
  }

  return (
    <div className="max-w-4xl">
      <PageHeader
        back={{ href: "/comercial", label: "Funil" }}
        title="Propostas"
        description="As enviadas aparecem por validade: as que vencem primeiro ficam no topo."
      />

      <nav aria-label="Filtrar por situação" className="mt-4 flex flex-wrap gap-2 text-sm">
        {FILTERS.map((filter) => (
          <AppLink
            key={filter.value}
            href={`/comercial/propostas?situacao=${filter.value}`}
            aria-current={active === filter.value ? "page" : undefined}
            className={`inline-flex min-h-11 items-center rounded-full border px-4 transition-colors sm:min-h-9 ${
              active === filter.value ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
            }`}
          >
            {filter.label}
          </AppLink>
        ))}
      </nav>

      {data.rows.length === 0 ? (
        <p className="mt-6 text-slate-500">
          Nenhuma proposta {status ? PROPOSAL_STATUS_LABEL[status].toLowerCase() : "cadastrada"} por aqui.
        </p>
      ) : (
        <ul className="mt-6 space-y-2">
          {data.rows.map((row) => (
            <li key={row.id}>
              <AppLink
                href={`/comercial/propostas/${row.id}`}
                className="block rounded-xl border border-line bg-white p-4 transition-colors hover:border-brand-300"
                data-testid="proposal-overview-row"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-slate-900">
                    {row.opportunityTitle} · v{row.number}
                  </span>
                  <ProposalStatusBadge status={row.status} expired={row.expired} />
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  {row.clientName} · {formatBRL(row.totalCents)}
                  {row.validUntil ? ` · válida até ${formatDateOnlyBR(row.validUntil)}` : ""}
                </p>
              </AppLink>
            </li>
          ))}
        </ul>
      )}
      {data.truncated && (
        <p role="status" className="mt-3 text-sm text-amber-800">
          Mostrando as 200 primeiras.
        </p>
      )}
    </div>
  );
}
