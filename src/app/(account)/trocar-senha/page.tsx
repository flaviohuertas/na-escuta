import { ChangePasswordForm } from "@/components/account/ChangePasswordForm";
import { requireSession } from "@/lib/auth/require-session";
import { prisma } from "@/lib/db/prisma";
import { PageHeader } from "@/components/ui/PageHeader";

export default async function ChangePasswordPage() {
  const session = await requireSession();
  const account = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { mustChangePassword: true },
  });

  return (
    <div>
      <PageHeader title="Trocar senha" />
      <ChangePasswordForm forced={Boolean(account?.mustChangePassword)} />
    </div>
  );
}
