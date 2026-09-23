import { notFound } from "next/navigation";
import { AppLink } from "@/components/ui/AppLink";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { buttonClass } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { STAGE_LABEL, formatBRL, formatDateBR, type OpportunityStageName } from "@/lib/domain/crm";
import { AdminActionError } from "@/server/errors";
import type { OpportunityCard, PipelineColumn } from "@/server/crm/opportunity.service";

// Cor só no desfecho: as etapas em andamento já se distinguem pelo nome (e pela coluna do funil).
const STAGE_TONE: Record<OpportunityStageName, BadgeTone> = {
  NEW: "neutral",
  CONTACTED: "neutral",
  PROPOSAL_SENT: "neutral",
  NEGOTIATION: "neutral",
  WON: "success",
  LOST: "danger",
};

export function StageBadge({ stage }: { stage: OpportunityStageName }) {
  return <Badge tone={STAGE_TONE[stage]}>{STAGE_LABEL[stage]}</Badge>;
}

/** Quem não é do comercial (ou não tem empresa) vê isto, não uma página de erro. */
export function CrmForbidden({ message }: { message: string }) {
  return (
    <div className="max-w-xl">
      <PageHeader title="Comercial" description={message} />
      <AppLink href="/eventos" className={buttonClass({ variant: "secondary", className: "mt-6" })}>
        Voltar aos eventos
      </AppLink>
    </div>
  );
}

/**
 * O que uma página do comercial mostra quando o serviço recusa: "não existe" (404 — inclusive o que
 * é de outra empresa) vira a página de não encontrado; sem permissão, o aviso. Qualquer outro erro é bug: relança.
 */
export function crmErrorView(err: unknown): React.ReactElement {
  if (err instanceof AdminActionError) {
    if (err.status === 404) notFound();
    return <CrmForbidden message={err.message} />;
  }
  throw err;
}

/** Um cartão de oportunidade (no funil e nas listas). */
export function OpportunityCardLink({ card }: { card: OpportunityCard }) {
  return (
    <AppLink
      href={`/comercial/oportunidades/${card.id}`}
      className="block rounded-xl border border-line bg-white p-3 text-sm transition-colors hover:border-brand-300"
      data-testid="opportunity-card"
    >
      <span className="block font-medium text-slate-900">{card.title}</span>
      <span className="mt-0.5 block text-xs text-slate-600">{card.clientName}</span>
      <span className="mt-1.5 flex flex-wrap items-center justify-between gap-x-2 text-xs text-slate-500">
        <span>{card.expectedValueCents !== null ? formatBRL(card.expectedValueCents) : "Sem valor"}</span>
        <span>{card.expectedStartDate ? formatDateBR(card.expectedStartDate) : ""}</span>
      </span>
      {card.ownerName && <span className="mt-1 block text-xs text-slate-400">{card.ownerName}</span>}
    </AppLink>
  );
}

/** O funil: uma coluna por etapa em andamento, com a contagem e o valor somado de cada uma. */
export function PipelineBoard({ columns }: { columns: PipelineColumn[] }) {
  return (
    <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {columns.map((column) => (
        <section key={column.stage} aria-labelledby={`stage-${column.stage}`} className="rounded-lg bg-slate-50 p-3" data-testid={`column-${column.stage}`}>
          <h2 id={`stage-${column.stage}`} className="text-sm font-semibold text-slate-800">
            {STAGE_LABEL[column.stage]} <span className="font-normal text-slate-500">({column.count})</span>
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">{formatBRL(column.totalCents)}</p>
          <ul className="mt-3 space-y-2">
            {column.items.map((card) => (
              <li key={card.id}>
                <OpportunityCardLink card={card} />
              </li>
            ))}
            {column.count === 0 && <li className="text-xs text-slate-400">Nenhuma oportunidade.</li>}
          </ul>
        </section>
      ))}
    </div>
  );
}
