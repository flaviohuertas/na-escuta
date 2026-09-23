import { SupplierForbidden } from "@/components/suppliers/SupplierParts";
import { SupplierForm } from "@/components/suppliers/SupplierForm";
import { requireSession } from "@/lib/auth/require-session";
import { canManageSuppliers } from "@/lib/domain/permissions";
import { getActiveCompanyRole } from "@/server/auth/membership";
import { PageHeader } from "@/components/ui/PageHeader";

/** Renderizada no servidor e SEM cache do Service Worker; quem pode cadastrar é revalidado a cada abertura. */
export default async function NewSupplierPage() {
  const session = await requireSession();
  const role = await getActiveCompanyRole(session.user.id, session.user.companyId);
  if (!role || !canManageSuppliers(role)) return <SupplierForbidden message="Você não tem acesso aos fornecedores desta empresa." />;

  return (
    <div className="max-w-xl">
      <PageHeader back={{ href: "/fornecedores", label: "Fornecedores" }} title="Novo fornecedor" />
      <SupplierForm mode="create" />
    </div>
  );
}
