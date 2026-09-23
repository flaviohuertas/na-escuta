import { AppLink } from "@/components/ui/AppLink";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { formatBRL, formatDocument } from "@/lib/domain/crm";
import { PROPOSAL_STATUS_LABEL, computeTotals, formatDateOnlyBR, type ProposalStatusName } from "@/lib/domain/proposal";
import type { ProposalRow } from "@/server/crm/proposal.service";
import { formatDateTimeBR } from "@/lib/domain/approval-format";

// A enviada é a proposta viva, esperando o cliente: leva a cor da marca. Rascunho e substituída, neutras.
const STATUS_TONE: Record<ProposalStatusName, BadgeTone> = {
  DRAFT: "neutral",
  SENT: "brand",
  ACCEPTED: "success",
  REJECTED: "danger",
  SUPERSEDED: "neutral",
};

export function ProposalStatusBadge({ status, expired = false }: { status: ProposalStatusName; expired?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Badge tone={STATUS_TONE[status]}>{PROPOSAL_STATUS_LABEL[status]}</Badge>
      {expired && <Badge tone="warning">Vencida</Badge>}
    </span>
  );
}

/** As versões das propostas de uma oportunidade (da mais nova à mais antiga). */
export function ProposalVersionList({ rows }: { rows: ProposalRow[] }) {
  return (
    <ul className="mt-2 space-y-2">
      {rows.map((row) => (
        <li key={row.id}>
          <AppLink
            href={`/comercial/propostas/${row.id}`}
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-white px-3 py-2 text-sm hover:border-brand-300"
            data-testid="proposal-row"
          >
            <span className="font-medium text-slate-900">Proposta v{row.number}</span>
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
              <span>{formatBRL(row.totalCents)}</span>
              {row.validUntil && <span>válida até {formatDateOnlyBR(row.validUntil)}</span>}
              <ProposalStatusBadge status={row.status} expired={row.expired} />
            </span>
          </AppLink>
        </li>
      ))}
    </ul>
  );
}

export interface ProposalDocumentData {
  companyName: string;
  opportunityTitle: string;
  client: { name: string; document: string | null; email: string | null; phone: string | null };
  proposal: {
    number: number;
    status: ProposalStatusName;
    notes: string | null;
    discountCents: number;
    sentAt: Date | null;
    items: Array<{ id: string; description: string; quantity: number; unitPriceCents: number }>;
  };
  validUntil: string | null;
}

/**
 * A proposta como o cliente a lê: quem propõe, para quem, os itens, os totais, a validade e as
 * condições. É o que se imprime (ou salva em PDF pelo navegador): a navegação some na impressão.
 * Os totais saem da MESMA conta que o servidor gravou.
 */
export function ProposalDocument({ data }: { data: ProposalDocumentData }) {
  const { proposal, client } = data;
  const totals = computeTotals(proposal.items, proposal.discountCents);

  return (
    <article aria-label="Proposta comercial" className="rounded-xl border border-line bg-white p-5 print:rounded-none print:border-0 print:p-0 sm:p-8">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-4">
        <div>
          <p className="text-sm font-medium text-slate-500">{data.companyName}</p>
          <h2 className="text-xl font-semibold text-slate-900">Proposta comercial</h2>
          <p className="mt-0.5 text-sm text-slate-600">{data.opportunityTitle}</p>
        </div>
        <div className="text-right text-sm text-slate-600">
          <p className="font-medium text-slate-900">Versão {proposal.number}</p>
          {proposal.sentAt && <p>Enviada em {formatDateTimeBR(proposal.sentAt.toISOString())}</p>}
          <p>Válida até {formatDateOnlyBR(data.validUntil)}</p>
        </div>
      </header>

      <section aria-label="Cliente" className="mt-4 text-sm text-slate-700">
        <p className="text-xs uppercase tracking-wide text-slate-500">Para</p>
        <p className="font-medium text-slate-900">{client.name}</p>
        {client.document && <p>{formatDocument(client.document)}</p>}
        {(client.email || client.phone) && <p>{[client.email, client.phone].filter(Boolean).join(" · ")}</p>}
      </section>

      <div className="relative mt-5 overflow-x-auto" role="region" aria-label="Itens da proposta" tabIndex={0}>
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Itens da proposta</caption>
          <thead>
            <tr className="border-b border-slate-300 text-xs uppercase tracking-wide text-slate-500">
              <th scope="col" className="py-2 pr-3 font-medium">
                Item
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Qtd.
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Preço unit.
              </th>
              <th scope="col" className="py-2 pl-3 text-right font-medium">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {proposal.items.map((item, index) => (
              <tr key={item.id} className="border-b border-slate-100" data-testid="proposal-item">
                <td className="py-2 pr-3 text-slate-900">{item.description}</td>
                <td className="px-3 py-2 text-right tabular-nums">{item.quantity}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatBRL(item.unitPriceCents)}</td>
                <td className="py-2 pl-3 text-right tabular-nums">{formatBRL(totals.lineTotals[index]!)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <dl className="mt-4 ml-auto w-full max-w-xs space-y-1 text-sm">
        <div className="flex justify-between">
          <dt className="text-slate-600">Subtotal</dt>
          <dd className="tabular-nums" data-testid="proposal-subtotal">
            {formatBRL(totals.subtotalCents)}
          </dd>
        </div>
        {totals.discountCents > 0 && (
          <div className="flex justify-between">
            <dt className="text-slate-600">Desconto</dt>
            <dd className="tabular-nums" data-testid="proposal-discount">
              − {formatBRL(totals.discountCents)}
            </dd>
          </div>
        )}
        <div className="flex justify-between border-t border-slate-300 pt-1 text-base font-semibold text-slate-900">
          <dt>Total</dt>
          <dd className="tabular-nums" data-testid="proposal-total">
            {formatBRL(totals.totalCents)}
          </dd>
        </div>
      </dl>

      {proposal.notes && (
        <section aria-label="Condições e observações" className="mt-6 text-sm">
          <p className="text-xs uppercase tracking-wide text-slate-500">Condições e observações</p>
          <p className="mt-1 whitespace-pre-line text-slate-800">{proposal.notes}</p>
        </section>
      )}
    </article>
  );
}
