import { AppLink } from "@/components/ui/AppLink";
import { crmErrorView } from "@/components/crm/CrmParts";
import { OpportunityForm } from "@/components/crm/OpportunityForm";
import { requireSession } from "@/lib/auth/require-session";
import { listClientOptions } from "@/server/crm/client.service";
import { listOwnerOptions } from "@/server/crm/opportunity.service";

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
    <div className="mx-auto max-w-xl">
      <h1 className="text-2xl font-semibold text-slate-900">Nova oportunidade</h1>
      {clients.length === 0 ? (
        <div className="mt-4 rounded-md bg-slate-100 px-4 py-3 text-sm text-slate-700">
          <p>Cadastre um cliente antes de abrir uma oportunidade.</p>
          <AppLink href="/comercial/clientes/novo" className="mt-3 inline-block font-medium text-brand-700 hover:underline">
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
