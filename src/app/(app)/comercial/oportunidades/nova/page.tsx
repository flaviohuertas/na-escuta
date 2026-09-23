import { AppLink } from "@/components/ui/AppLink";
import { crmErrorView } from "@/components/crm/CrmParts";
import { OpportunityForm } from "@/components/crm/OpportunityForm";
import { requireSession } from "@/lib/auth/require-session";
import { listClientOptions } from "@/server/crm/client.service";
import { listOwnerOptions } from "@/server/crm/opportunity.service";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { buttonClass } from "@/components/ui/Button";

/** Abrir uma oportunidade. `?clienteId=` já vem com o cliente escolhido (a partir da tela do cliente). */
export default async function NewOpportunityPage({ searchParams }: { searchParams: Promise<{ clienteId?: string }> }) {
  const session = await requireSession();
  const { clienteId } = await searchParams;
  const ctx = { userId: session.user.id, companyId: session.user.companyId };

  let clients: Awaited<ReturnType<typeof listClientOptions>>;
  let owners: Awaited<ReturnType<typeof listOwnerOptions>>;
  try {
    [clients, owners] = await Promise.all([listClientOptions(ctx), listOwnerOptions(ctx)]);
  } catch (err) {
    return crmErrorView(err);
  }

  return (
    <div className="max-w-xl">
      <PageHeader back={{ href: "/comercial", label: "Funil" }} title="Nova oportunidade" />
      {clients.length === 0 ? (
        <div className="mt-6">
          <EmptyState hint="Toda oportunidade é de um cliente.">Cadastre um cliente antes de abrir uma oportunidade.</EmptyState>
          <AppLink href="/comercial/clientes/novo" className={buttonClass({ className: "mt-4" })}>
            Cadastrar cliente
          </AppLink>
        </div>
      ) : (
        <OpportunityForm
          mode="create"
          clients={clients}
          owners={owners}
          currentUserId={session.user.id}
          defaultClientId={clients.some((c) => c.id === clienteId) ? clienteId : undefined}
        />
      )}
    </div>
  );
}
