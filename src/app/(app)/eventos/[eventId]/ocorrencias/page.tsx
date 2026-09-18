import { requireSession } from "@/lib/auth/require-session";
import { OccurrencesScreen } from "@/components/occurrences/OccurrencesScreen";

export default async function OcorrenciasPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  const session = await requireSession();

  return (
    <OccurrencesScreen
      eventId={eventId}
      userId={session.user.id}
      companyId={session.user.companyId}
    />
  );
}
