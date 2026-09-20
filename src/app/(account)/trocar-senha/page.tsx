import { ChangePasswordForm } from "@/components/account/ChangePasswordForm";
import { requireSession } from "@/lib/auth/require-session";
import { prisma } from "@/lib/db/prisma";

export default async function ChangePasswordPage() {
  const session = await requireSession();
  const account = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { mustChangePassword: true },
  });

  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-900">Trocar senha</h1>
      <ChangePasswordForm forced={Boolean(account?.mustChangePassword)} />
    </div>
  );
}
