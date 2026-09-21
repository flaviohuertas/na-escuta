import { notFound } from "next/navigation";
import { AppLink } from "@/components/ui/AppLink";
import { formatBRL } from "@/lib/domain/crm";
import type { SpendGroup } from "@/lib/domain/supplier";
import { AdminActionError } from "@/server/errors";

/** Quem não é do cadastro de fornecedores (ou não tem empresa) vê isto, não uma página de erro. */
export function SupplierForbidden({ message }: { message: string }) {
  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-2xl font-semibold text-slate-900">Fornecedores</h1>
      <div className="mt-4 rounded-md bg-slate-100 px-4 py-3 text-sm text-slate-700">
        <p>{message}</p>
        <AppLink href="/eventos" className="mt-3 inline-block font-medium text-brand-700 hover:underline">
          Voltar aos eventos
        </AppLink>
      </div>
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

      <dl className="mt-3 grid gap-4 rounded-lg border border-slate-200 bg-white p-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">Gasto (lançado)</dt>
          <dd className="text-base font-semibold tabular-nums text-slate-900" data-testid="spend-realized">
            {formatBRL(summary.realizedTotalCents)}
          </dd>
          <dd className="text-xs text-slate-500">
            {summary.realizedCount} lançamento{summary.realizedCount === 1 ? "" : "s"}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">Orçado</dt>
          <dd className="text-base font-semibold tabular-nums text-slate-900" data-testid="spend-planned">
            {formatBRL(summary.plannedTotalCents)}
          </dd>
          <dd className="text-xs text-slate-500">
            {summary.plannedCount} item{summary.plannedCount === 1 ? "" : "s"} de orçamento
          </dd>
        </div>
      </dl>
      {summary.overPlanned && (
        <p role="status" className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="spend-over">
          Gastou-se mais com este fornecedor do que o orçado com ele.
        </p>
      )}

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">Gasto por evento</h3>
          {realized.length === 0 ? (
            <p className="mt-1 text-sm text-slate-500">Nenhum lançamento com este fornecedor.</p>
          ) : (
            <ul className="mt-1 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white text-sm" data-testid="spend-events">
              {realized.map((group) => (
                <li key={group.id} className="flex items-center justify-between gap-2 px-3 py-2">
                  <AppLink href={`/financeiro/eventos/${group.id}`} className="font-medium text-brand-700 hover:underline">
                    {group.name}
                  </AppLink>
                  <span className="tabular-nums text-slate-900">{formatBRL(group.totalCents)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3 className="text-sm font-semibold text-slate-800">Orçado por oportunidade</h3>
          {planned.length === 0 ? (
            <p className="mt-1 text-sm text-slate-500">Nenhum orçamento cita este fornecedor.</p>
          ) : (
            <ul className="mt-1 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white text-sm" data-testid="spend-opportunities">
              {planned.map((group) => (
                <li key={group.id} className="flex items-center justify-between gap-2 px-3 py-2">
                  <AppLink href={`/comercial/oportunidades/${group.id}/orcamento`} className="font-medium text-brand-700 hover:underline">
                    {group.name}
                  </AppLink>
                  <span className="tabular-nums text-slate-900">{formatBRL(group.totalCents)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
