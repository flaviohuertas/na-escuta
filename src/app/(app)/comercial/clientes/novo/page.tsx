import { CrmForbidden } from "@/components/crm/CrmParts";
import { ClientForm } from "@/components/crm/ClientForm";
import { requireSession } from "@/lib/auth/require-session";
import { canManageCrm } from "@/lib/domain/permissions";
import { getActiveCompanyRole } from "@/server/auth/membership";

/** Renderizada no servidor e SEM cache do Service Worker; quem pode cadastrar é revalidado a cada abertura. */
export default async function NewClientPage() {
  const session = await requireSession();
  const role = await getActiveCompanyRole(session.user.id, session.user.companyId);
  if (!role || !canManageCrm(role)) return <CrmForbidden message="Você não tem acesso ao comercial desta empresa." />;

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-2xl font-semibold text-slate-900">Novo cliente</h1>
      <ClientForm mode="create" />
    </div>
  );
}
