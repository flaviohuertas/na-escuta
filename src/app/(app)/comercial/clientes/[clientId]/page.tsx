import { AppLink } from "@/components/ui/AppLink";
import { ClientArchiveButton } from "@/components/crm/ClientArchiveButton";
import { ClientForm } from "@/components/crm/ClientForm";
import { StageBadge, crmErrorView } from "@/components/crm/CrmParts";
import { requireSession } from "@/lib/auth/require-session";
import { formatBRL, formatDocument } from "@/lib/domain/crm";
import { getClient } from "@/server/crm/client.service";
import { buttonClass } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";

/** O cliente: edição, arquivar/reativar e as oportunidades dele. Ao vivo; sem cache do Service Worker. */
export default async function ClientPage({ params }: { params: Promise<{ clientId: string }> }) {
  const session = await requireSession();
  const { clientId } = await params;

  let data: Awaited<ReturnType<typeof getClient>>;
  try {
    data = await getClient({ userId: session.user.id, companyId: session.user.companyId, clientId });
  } catch (err) {
    return crmErrorView(err);
  }
  const { client, opportunities } = data;
  const archived = client.archivedAt !== null;

  return (
    <div className="max-w-xl">
      <PageHeader back={{ href: "/comercial/clientes", label: "Clientes" }} title={client.name} />
      {archived && (
        <p role="status" className="mt-2 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">
          Cliente arquivado. Reative-o para editar o cadastro ou abrir novas oportunidades.
        </p>
      )}

      {archived ? (
        <dl className="mt-4 space-y-1 text-sm text-slate-700">
          {client.document && (
            <div>
              <dt className="inline font-medium">Documento: </dt>
              <dd className="inline">{formatDocument(client.document)}</dd>
            </div>
          )}
          {client.email && (
            <div>
              <dt className="inline font-medium">E-mail: </dt>
              <dd className="inline">{client.email}</dd>
            </div>
          )}
          {client.phone && (
            <div>
              <dt className="inline font-medium">Telefone: </dt>
              <dd className="inline">{client.phone}</dd>
            </div>
          )}
        </dl>
      ) : (
        <ClientForm
          mode="edit"
          initial={{
            id: client.id,
            name: client.name,
            kind: client.kind,
            document: client.document,
            email: client.email,
            phone: client.phone,
            notes: client.notes,
            version: client.version,
          }}
        />
      )}

      <ClientArchiveButton clientId={client.id} version={client.version} archived={archived} />

      <section aria-labelledby="client-opps" className="mt-8">
        <div className="flex items-center justify-between gap-2">
          <h2 id="client-opps" className="text-lg font-semibold text-slate-900">
            Oportunidades
          </h2>
          {!archived && (
            <AppLink href={`/comercial/oportunidades/nova?clienteId=${client.id}`} className={buttonClass({ variant: "secondary", size: "sm" })}>
              Nova oportunidade
            </AppLink>
          )}
        </div>
        {opportunities.length === 0 ? (
          <div className="mt-2">
            <EmptyState>Nenhuma oportunidade com este cliente ainda.</EmptyState>
          </div>
        ) : (
          <ul className="mt-2 space-y-2">
            {opportunities.map((opportunity) => (
              <li key={opportunity.id}>
                <AppLink
                  href={`/comercial/oportunidades/${opportunity.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-white px-3 py-2 text-sm hover:border-brand-300"
                >
                  <span className="font-medium text-slate-900">{opportunity.title}</span>
                  <span className="flex items-center gap-2">
                    {opportunity.expectedValueCents !== null && <span className="text-xs text-slate-500">{formatBRL(opportunity.expectedValueCents)}</span>}
                    <StageBadge stage={opportunity.stage} />
                  </span>
                </AppLink>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
