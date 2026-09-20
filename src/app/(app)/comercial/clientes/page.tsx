import { AppLink } from "@/components/ui/AppLink";
import { crmErrorView } from "@/components/crm/CrmParts";
import { requireSession } from "@/lib/auth/require-session";
import { formatDocument } from "@/lib/domain/crm";
import { listClients } from "@/server/crm/client.service";

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
    <div className="mx-auto max-w-4xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Clientes</h1>
          <p className="mt-1 text-sm text-slate-500">Quem contrata a produtora. Um cliente nunca é apagado: quem deixa de ser cliente é arquivado.</p>
        </div>
        <AppLink href="/comercial/clientes/novo" className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
          Novo cliente
        </AppLink>
      </div>

      <form method="get" role="search" aria-label="Buscar clientes" className="mt-4 flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <label htmlFor="q" className="block text-sm font-medium text-slate-700">
            Buscar por nome, e-mail ou CPF/CNPJ
          </label>
          <input
            id="q"
            name="q"
            defaultValue={q ?? ""}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
          />
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm text-slate-700">
          <input type="checkbox" name="arquivados" value="1" defaultChecked={arquivados === "1"} />
          Mostrar arquivados
        </label>
        <button type="submit" className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
          Buscar
        </button>
      </form>

      {data.rows.length === 0 ? (
        <p className="mt-6 text-slate-500">{q ? "Nenhum cliente encontrado para esta busca." : "Nenhum cliente cadastrado ainda."}</p>
      ) : (
        <ul className="mt-6 space-y-2">
          {data.rows.map((client) => (
            <li key={client.id}>
              <AppLink
                href={`/comercial/clientes/${client.id}`}
                className="block rounded-lg border border-slate-200 bg-white p-4 shadow-sm hover:border-brand-300 hover:shadow"
                data-testid="client-row"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-slate-900">{client.name}</span>
                  <span className="flex gap-2 text-xs">
                    {client.archived && <span className="rounded-full bg-slate-200 px-2 py-0.5 text-slate-700">Arquivado</span>}
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">{client.kind === "COMPANY" ? "Empresa" : "Pessoa"}</span>
                    {client.openOpportunities > 0 && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-900">
                        {client.openOpportunities} em andamento
                      </span>
                    )}
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
