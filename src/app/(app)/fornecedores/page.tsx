import { AppLink } from "@/components/ui/AppLink";
import { inputClass } from "@/components/ui/Field";
import { supplierErrorView } from "@/components/suppliers/SupplierParts";
import { requireSession } from "@/lib/auth/require-session";
import { BUDGET_CATEGORIES } from "@/lib/domain/budget";
import { supplierSummaryLine } from "@/lib/domain/supplier";
import { listSuppliers } from "@/server/suppliers/supplier.service";
import { buttonClass } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge } from "@/components/ui/Badge";

/**
 * Os fornecedores da empresa, com busca (nome, contato, e-mail ou CPF/CNPJ) e filtro pela categoria
 * principal. Ao vivo; exige conexão; fora do cache do Service Worker.
 */
export default async function SuppliersPage({ searchParams }: { searchParams: Promise<{ q?: string; categoria?: string; arquivados?: string }> }) {
  const session = await requireSession();
  const { q, categoria, arquivados } = await searchParams;
  const category = BUDGET_CATEGORIES.some((c) => c.code === categoria) ? categoria : undefined;

  let data: Awaited<ReturnType<typeof listSuppliers>>;
  try {
    data = await listSuppliers({ userId: session.user.id, companyId: session.user.companyId, search: q, category, includeArchived: arquivados === "1" });
  } catch (err) {
    return supplierErrorView(err);
  }

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Fornecedores"
        description="Quem fornece serviço ou material à produtora. Um fornecedor nunca é apagado: quem deixa de fornecer é arquivado."
        actions={
          <AppLink href="/fornecedores/novo" className={buttonClass()}>
            Novo fornecedor
          </AppLink>
        }
      />

      <form method="get" role="search" aria-label="Buscar fornecedores" className="mt-4 flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <label htmlFor="q" className="block text-sm font-medium text-slate-700">
            Buscar por nome, contato, e-mail ou CPF/CNPJ
          </label>
          <input
            id="q"
            name="q"
            defaultValue={q ?? ""}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="categoria" className="block text-sm font-medium text-slate-700">
            Categoria
          </label>
          <select
            id="categoria"
            name="categoria"
            defaultValue={category ?? ""}
            className={inputClass}
          >
            <option value="">Todas</option>
            {BUDGET_CATEGORIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <label className="flex min-h-11 items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" name="arquivados" value="1" defaultChecked={arquivados === "1"} className="size-4 accent-brand-600" />
          Mostrar arquivados
        </label>
        <button type="submit" className={buttonClass({ variant: "secondary" })}>
          Buscar
        </button>
      </form>

      {data.rows.length === 0 ? (
        <div className="mt-6">
          {q || category ? (
            <EmptyState hint="Confira a grafia, busque por parte do nome ou escolha outra categoria.">Nenhum fornecedor encontrado para esta busca.</EmptyState>
          ) : (
            <EmptyState hint="Cadastre o primeiro em Novo fornecedor.">Nenhum fornecedor cadastrado ainda.</EmptyState>
          )}
        </div>
      ) : (
        <ul className="mt-6 space-y-2">
          {data.rows.map((supplier) => (
            <li key={supplier.id}>
              <AppLink
                href={`/fornecedores/${supplier.id}`}
                className="block rounded-xl border border-line bg-white p-4 transition-colors hover:border-brand-300"
                data-testid="supplier-row"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-slate-900">{supplier.name}</span>
                  {supplier.archived && <Badge tone="neutral">Arquivado</Badge>}
                </div>
                <p className="mt-1 text-sm text-slate-500">{supplierSummaryLine(supplier)}</p>
                <p className="mt-0.5 text-sm text-slate-500">
                  {[supplier.contactName, supplier.email, supplier.phone].filter(Boolean).join(" · ") || "Sem contato"}
                </p>
              </AppLink>
            </li>
          ))}
        </ul>
      )}
      {data.truncated && (
        <p role="status" className="mt-3 text-sm text-amber-800">
          Mostrando os 200 primeiros. Refine a busca para ver os outros.
        </p>
      )}
    </div>
  );
}
