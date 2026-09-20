import { notFound } from "next/navigation";
import { AppLink } from "@/components/ui/AppLink";
import { STAGE_LABEL, formatBRL, formatDateBR, type OpportunityStageName } from "@/lib/domain/crm";
import { AdminActionError } from "@/server/errors";
import type { OpportunityCard, PipelineColumn } from "@/server/crm/opportunity.service";

const STAGE_STYLE: Record<OpportunityStageName, string> = {
  NEW: "bg-slate-100 text-slate-800",
  CONTACTED: "bg-sky-100 text-sky-900",
  PROPOSAL_SENT: "bg-indigo-100 text-indigo-900",
  NEGOTIATION: "bg-amber-100 text-amber-900",
  WON: "bg-emerald-100 text-emerald-900",
  LOST: "bg-red-100 text-red-900",
};

export function StageBadge({ stage }: { stage: OpportunityStageName }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STAGE_STYLE[stage]}`}>{STAGE_LABEL[stage]}</span>;
}

/** Quem não é do comercial (ou não tem empresa) vê isto, não uma página de erro. */
export function CrmForbidden({ message }: { message: string }) {
  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-2xl font-semibold text-slate-900">Comercial</h1>
      <div className="mt-4 rounded-md bg-slate-100 px-4 py-3 text-sm text-slate-700">
        <p>{message}</p>
        <AppLink href="/eventos" className="mt-3 inline-block font-medium text-brand-700 hover:underline">
          Voltar aos eventos
        </AppLink>
      </div>
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
      className="block rounded-md border border-slate-200 bg-white p-3 text-sm shadow-sm hover:border-brand-300 hover:shadow"
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
