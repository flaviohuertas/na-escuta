import { CrmForbidden } from "@/components/crm/CrmParts";
import { ClientForm } from "@/components/crm/ClientForm";
import { requireSession } from "@/lib/auth/require-session";
import { canManageCrm } from "@/lib/domain/permissions";
import { getActiveCompanyRole } from "@/server/auth/membership";
import { PageHeader } from "@/components/ui/PageHeader";

/** Renderizada no servidor e SEM cache do Service Worker; quem pode cadastrar é revalidado a cada abertura. */
export default async function NewClientPage() {
  const session = await requireSession();
  const role = await getActiveCompanyRole(session.user.id, session.user.companyId);
  if (!role || !canManageCrm(role)) return <CrmForbidden message="Você não tem acesso ao comercial desta empresa." />;

  return (
    <div className="max-w-xl">
      <PageHeader back={{ href: "/comercial/clientes", label: "Clientes" }} title="Novo cliente" />
      <ClientForm mode="create" />
    </div>
  );
}
