import { AppLink } from "@/components/ui/AppLink";
import { inputClass } from "@/components/ui/Field";
import { crmErrorView } from "@/components/crm/CrmParts";
import { requireSession } from "@/lib/auth/require-session";
import { formatDocument } from "@/lib/domain/crm";
import { listClients } from "@/server/crm/client.service";
import { buttonClass } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge } from "@/components/ui/Badge";

/** Clientes da empresa, com busca (nome, e-mail ou CPF/CNPJ). Ao vivo; exige conexão. */
export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ q?: string; arquivados?: string }> }) {
  const session = await requireSession();
  const { q, arquivados } = await searchParams;

  let data: Awaited<ReturnType<typeof listClients>>;
  try {
    data = await listClients({
      userId: session.user.id,
      companyId: session.user.companyId,
      search: q,
      includeArchived: arquivados === "1",
    });
  } catch (err) {
    return crmErrorView(err);
  }

  return (
    <div className="max-w-4xl">
      <PageHeader
        back={{ href: "/comercial", label: "Funil" }}
        title="Clientes"
        description="Quem contrata a produtora. Um cliente nunca é apagado: quem deixa de ser cliente é arquivado."
        actions={
          <AppLink href="/comercial/clientes/novo" className={buttonClass()}>
            Novo cliente
          </AppLink>
        }
      />

      <form method="get" role="search" aria-label="Buscar clientes" className="mt-4 flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <label htmlFor="q" className="block text-sm font-medium text-slate-700">
            Buscar por nome, e-mail ou CPF/CNPJ
          </label>
          <input
            id="q"
            name="q"
            defaultValue={q ?? ""}
            className={inputClass}
          />
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
          {q ? (
            <EmptyState hint="Confira a grafia ou busque por parte do nome, do e-mail ou do documento.">Nenhum cliente encontrado para esta busca.</EmptyState>
          ) : (
            <EmptyState hint="Cadastre o primeiro em Novo cliente.">Nenhum cliente cadastrado ainda.</EmptyState>
          )}
        </div>
      ) : (
        <ul className="mt-6 space-y-2">
          {data.rows.map((client) => (
            <li key={client.id}>
              <AppLink
                href={`/comercial/clientes/${client.id}`}
                className="block rounded-xl border border-line bg-white p-4 transition-colors hover:border-brand-300"
                data-testid="client-row"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-slate-900">{client.name}</span>
                  <span className="flex gap-2">
                    {client.archived && <Badge tone="neutral">Arquivado</Badge>}
                    <Badge tone="neutral">{client.kind === "COMPANY" ? "Empresa" : "Pessoa"}</Badge>
                    {client.openOpportunities > 0 && <Badge tone="brand">{client.openOpportunities} em andamento</Badge>}
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  {[client.document ? formatDocument(client.document) : null, client.email, client.phone].filter(Boolean).join(" · ") || "Sem contato"}
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
