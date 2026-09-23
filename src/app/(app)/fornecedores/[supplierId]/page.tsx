import { PageHeader } from "@/components/ui/PageHeader";
import { NoValue } from "@/components/ui/Stat";
import { SupplierArchiveButton } from "@/components/suppliers/SupplierArchiveButton";
import { SupplierForm } from "@/components/suppliers/SupplierForm";
import { SupplierSpendSection, supplierErrorView } from "@/components/suppliers/SupplierParts";
import { requireSession } from "@/lib/auth/require-session";
import { formatDateTimeBR } from "@/lib/domain/approval-format";
import { categoryLabel } from "@/lib/domain/budget";
import { formatDocument } from "@/lib/domain/crm";
import { SUPPLIER_KIND_LABEL, type SupplierKindName } from "@/lib/domain/supplier";
import { canManageFinance } from "@/lib/domain/permissions";
import { getActiveCompanyRole } from "@/server/auth/membership";
import { getSupplier, getSupplierSpend } from "@/server/suppliers/supplier.service";

/**
 * O fornecedor: edição do cadastro, arquivar/reativar, o histórico e — só para quem vê o
 * financeiro — quanto se gastou e se orçou com ele. Ao vivo; fora do cache do Service Worker.
 */
export default async function SupplierPage({ params }: { params: Promise<{ supplierId: string }> }) {
  const session = await requireSession();
  const { supplierId } = await params;
  const ctx = { userId: session.user.id, companyId: session.user.companyId };

  let data: Awaited<ReturnType<typeof getSupplier>>;
  let spend: Awaited<ReturnType<typeof getSupplierSpend>> | null = null;
  try {
    data = await getSupplier({ ...ctx, supplierId });
    // O dinheiro é do financeiro: quem só cuida do cadastro (a produção) nem chega a pedir.
    const role = await getActiveCompanyRole(ctx.userId, ctx.companyId);
    if (role && canManageFinance(role)) spend = await getSupplierSpend({ ...ctx, supplierId });
  } catch (err) {
    return supplierErrorView(err);
  }
  const { supplier, history } = data;
  const archived = supplier.archivedAt !== null;

  return (
    <div className="max-w-xl">
      <PageHeader back={{ href: "/fornecedores", label: "Fornecedores" }} title={supplier.name} />
      {archived && (
        <p role="status" className="mt-2 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">
          Fornecedor arquivado. Reative-o para editar o cadastro ou vinculá-lo a novos orçamentos e lançamentos. Os vínculos que já existem continuam.
        </p>
      )}

      {archived ? (
        <dl className="mt-4 space-y-1 text-sm text-slate-700">
          <div>
            <dt className="inline font-medium">Tipo: </dt>
            <dd className="inline">{SUPPLIER_KIND_LABEL[supplier.kind as SupplierKindName]}</dd>
          </div>
          {supplier.document && (
            <div>
              <dt className="inline font-medium">Documento: </dt>
              <dd className="inline">{formatDocument(supplier.document)}</dd>
            </div>
          )}
          {supplier.category && (
            <div>
              <dt className="inline font-medium">Categoria: </dt>
              <dd className="inline">{categoryLabel(supplier.category)}</dd>
            </div>
          )}
          {supplier.contactName && (
            <div>
              <dt className="inline font-medium">Contato: </dt>
              <dd className="inline">{supplier.contactName}</dd>
            </div>
          )}
          {supplier.email && (
            <div>
              <dt className="inline font-medium">E-mail: </dt>
              <dd className="inline">{supplier.email}</dd>
            </div>
          )}
          {supplier.phone && (
            <div>
              <dt className="inline font-medium">Telefone: </dt>
              <dd className="inline">{supplier.phone}</dd>
            </div>
          )}
        </dl>
      ) : (
        <SupplierForm
          mode="edit"
          initial={{
            id: supplier.id,
            name: supplier.name,
            kind: supplier.kind,
            document: supplier.document,
            contactName: supplier.contactName,
            email: supplier.email,
            phone: supplier.phone,
            category: supplier.category,
            notes: supplier.notes,
            version: supplier.version,
          }}
        />
      )}

      <SupplierArchiveButton supplierId={supplier.id} version={supplier.version} archived={archived} />

      {spend && <SupplierSpendSection realized={spend.realized} planned={spend.planned} summary={spend.summary} />}

      {history.length > 0 && (
        <section aria-labelledby="history" className="mt-8">
          <h2 id="history" className="text-lg font-semibold text-slate-900">
            Histórico
          </h2>
          <ul className="mt-2 divide-y divide-slate-100 rounded-xl border border-line bg-white text-sm">
            {history.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2" data-testid="history-entry">
                <span className="text-slate-800">{entry.text}</span>
                <span className="text-xs text-slate-500">
                  {entry.actorName ?? <NoValue label="sem autor" />} · {formatDateTimeBR(entry.at.toISOString())}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
