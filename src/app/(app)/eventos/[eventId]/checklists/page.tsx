import { requireSession } from "@/lib/auth/require-session";
import { ChecklistsScreen } from "@/components/checklists/ChecklistsScreen";

export default async function ChecklistsPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  const session = await requireSession();

  return (
    <ChecklistsScreen
      eventId={eventId}
      userId={session.user.id}
      companyId={session.user.companyId}
    />
  );
}
