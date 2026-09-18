import { requireSession } from "@/lib/auth/require-session";
import { TasksScreen } from "@/components/tasks/TasksScreen";

export default async function TarefasPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  const session = await requireSession();

  return (
    <TasksScreen eventId={eventId} userId={session.user.id} companyId={session.user.companyId} />
  );
}
