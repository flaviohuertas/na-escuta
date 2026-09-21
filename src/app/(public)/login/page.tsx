import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { Button } from "@/components/ui/Button";
import { inputClass } from "@/components/ui/Field";
import { LogoMark, Wordmark } from "@/components/ui/Logo";
import { auth, signIn } from "@/lib/auth/auth.config";

async function loginAction(formData: FormData) {
  "use server";
  try {
    await signIn("credentials", {
      email: formData.get("email"),
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
      <div className="w-full max-w-sm rounded-2xl border border-line bg-white p-6 shadow-sm">
        <p className="text-sm text-slate-500">
          Entre com sua conta. A primeira utilização neste dispositivo exige conexão com a
          internet.
        </p>

        {erro && (
          <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            E-mail ou senha inválidos.
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
          <Button type="submit" className="w-full">
            Entrar
          </Button>
        </form>

        <p className="mt-4 text-xs text-slate-400">
          Login de demonstração: demo@naescuta.com.br / NaEscuta#2026
        </p>
      </div>
    </main>
  );
}
