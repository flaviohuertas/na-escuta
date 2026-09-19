import { requireSession } from "@/lib/auth/require-session";
import { loadDashboard } from "@/server/dashboard/dashboard.service";
import { DashboardView } from "@/components/dashboard/DashboardView";

/**
 * Painel gerencial — Server Component que consulta o Postgres ao vivo (exige
 * conexão, como o catálogo /eventos). Depende de cookies via requireSession(),
 * então é sempre renderizado sob demanda, nunca em cache estático.
 */
export default async function DashboardPage() {
  const session = await requireSession();
  const { portfolio, agenda, generatedAt } = await loadDashboard(session.user.id);
  return <DashboardView portfolio={portfolio} agenda={agenda} generatedAt={generatedAt} />;
}
