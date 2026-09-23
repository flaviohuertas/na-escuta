import { notFound } from "next/navigation";
import { AppLink } from "@/components/ui/AppLink";
import { buttonClass } from "@/components/ui/Button";
import { cardClass } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Stat } from "@/components/ui/Stat";
import { formatBRL } from "@/lib/domain/crm";
import type { SpendGroup } from "@/lib/domain/supplier";
import { AdminActionError } from "@/server/errors";

// A linha inteira é o link (alvo de 44 px), com o nome à esquerda e o valor à direita.
const SPEND_ROW = "flex min-h-11 items-center justify-between gap-2 px-3 py-2 transition-colors hover:bg-slate-50";

/** Quem não é do cadastro de fornecedores (ou não tem empresa) vê isto, não uma página de erro. */
export function SupplierForbidden({ message }: { message: string }) {
  return (
    <div className="max-w-xl">
      <PageHeader title="Fornecedores" description={message} />
      <AppLink href="/eventos" className={buttonClass({ variant: "secondary", className: "mt-6" })}>
        Voltar aos eventos
      </AppLink>
    </div>
  );
}

/** "Não existe" (404 — inclusive o que é de outra empresa) vira a página de não encontrado; sem permissão, o aviso. Qualquer outro erro é bug: relança. */
export function supplierErrorView(err: unknown): React.ReactElement {
  if (err instanceof AdminActionError) {
    if (err.status === 404) notFound();
    return <SupplierForbidden message={err.message} />;
  }
  throw err;
}

interface SpendSummary {
  realizedTotalCents: number;
  realizedCount: number;
  plannedTotalCents: number;
  plannedCount: number;
  overPlanned: boolean;
}

/**
 * Quanto se gastou (lançamentos ativos, por evento) e quanto se orçou (itens de orçamento, por
 * oportunidade) com este fornecedor. É DINHEIRO: a página só monta esta seção para quem vê o
 * financeiro — a produção mantém o cadastro sem ver um centavo daqui.
 */
export function SupplierSpendSection({ realized, planned, summary }: { realized: SpendGroup[]; planned: SpendGroup[]; summary: SpendSummary }) {
  return (
    <section aria-labelledby="spend" className="mt-8" data-testid="supplier-spend">
      <h2 id="spend" className="text-lg font-semibold text-slate-900">
        Quanto gastamos com este fornecedor
      </h2>
      <p className="mt-1 text-xs text-slate-500">Só titular e administração veem esta seção. Lançamentos estornados não contam.</p>

      <dl className={cardClass({ className: "mt-3 grid gap-4 sm:grid-cols-2" })}>
        <Stat
          label="Gasto (lançado)"
          valueTestId="spend-realized"
          value={formatBRL(summary.realizedTotalCents)}
          note={
            <dd className="mt-0.5 text-xs text-slate-500">
              {summary.realizedCount} lançamento{summary.realizedCount === 1 ? "" : "s"}
            </dd>
          }
        />
        <Stat
          label="Orçado"
          valueTestId="spend-planned"
          value={formatBRL(summary.plannedTotalCents)}
          note={
            <dd className="mt-0.5 text-xs text-slate-500">
              {summary.plannedCount} item{summary.plannedCount === 1 ? "" : "s"} de orçamento
            </dd>
          }
        />
      </dl>
      {summary.overPlanned && (
        <p role="status" className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="spend-over">
          Gastou-se mais com este fornecedor do que o orçado com ele.
        </p>
      )}

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">Gasto por evento</h3>
          {realized.length === 0 ? (
            <div className="mt-1">
              <EmptyState>Nenhum lançamento com este fornecedor.</EmptyState>
            </div>
          ) : (
            <ul className="mt-1 divide-y divide-slate-100 overflow-hidden rounded-xl border border-line bg-white text-sm" data-testid="spend-events">
              {realized.map((group) => (
                <li key={group.id}>
                  <AppLink href={`/financeiro/eventos/${group.id}`} className={SPEND_ROW}>
                    <span className="font-medium text-brand-700">{group.name}</span>
                    <span className="tabular-nums text-slate-900">{formatBRL(group.totalCents)}</span>
                  </AppLink>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3 className="text-sm font-semibold text-slate-800">Orçado por oportunidade</h3>
          {planned.length === 0 ? (
            <div className="mt-1">
              <EmptyState>Nenhum orçamento cita este fornecedor.</EmptyState>
            </div>
          ) : (
            <ul className="mt-1 divide-y divide-slate-100 overflow-hidden rounded-xl border border-line bg-white text-sm" data-testid="spend-opportunities">
              {planned.map((group) => (
                <li key={group.id}>
                  <AppLink href={`/comercial/oportunidades/${group.id}/orcamento`} className={SPEND_ROW}>
                    <span className="font-medium text-brand-700">{group.name}</span>
                    <span className="tabular-nums text-slate-900">{formatBRL(group.totalCents)}</span>
                  </AppLink>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
