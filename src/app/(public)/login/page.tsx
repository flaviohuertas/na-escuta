import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { inputClass } from "@/components/ui/Field";
import { LogoMark, Wordmark } from "@/components/ui/Logo";
import { auth, signIn } from "@/lib/auth/auth.config";
import { getLoginLockState } from "@/server/auth/credentials";

async function loginAction(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim().toLowerCase();

  if (await getLoginLockState(email) === "blocked") {
    redirect("/login?erro=bloqueado");
  }

  try {
    await signIn("credentials", {
      email,
      password: formData.get("password"),
      redirectTo: "/eventos",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      redirect("/login?erro=credenciais");
    }
    throw error;
  }
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect("/eventos");

  const { erro } = await searchParams;

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4 py-8">
      <div className="flex items-center gap-3">
        <LogoMark size={56} />
        <h1 className="text-4xl">
          <Wordmark />
        </h1>
      </div>
      <div className="w-full max-w-sm rounded-xl border border-line bg-white p-6">
        <p className="text-sm text-slate-500">
          Entre com sua conta. A primeira utilização neste dispositivo exige conexão com a
          internet.
        </p>

        {erro === "credenciais" && (
          <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            E-mail ou senha inválidos.
          </p>
        )}

        {erro === "bloqueado" && (
          <p role="alert" className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Muitas tentativas seguidas. Tente novamente em alguns minutos.
          </p>
        )}

        <form action={loginAction} className="mt-6 space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-slate-700">
              E-mail
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-slate-700">
              Senha
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className={inputClass}
            />
          </div>
          <SubmitButton pendingLabel="Entrando…" className="w-full">
            Entrar
          </SubmitButton>
        </form>

        <p className="mt-4 text-xs text-slate-400">
          Login de demonstração: demo@naescuta.com.br / NaEscuta#2026
        </p>
      </div>
    </main>
  );
}
