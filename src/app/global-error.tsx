"use client";

import "./globals.css";
import { Button } from "@/components/ui/Button";
import { LogoMark } from "@/components/ui/Logo";

/**
 * Erro no layout raiz: substitui o documento inteiro, por isso traz `<html>`, `<body>` e o CSS.
 * Não carrega as fontes da marca (o `next/font` mora no layout que falhou): cai no `system-ui`.
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-dvh font-sans antialiased">
        <title>Erro · Na Escuta</title>
        <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4 py-8">
          <LogoMark size={40} />
          <div className="w-full max-w-sm rounded-xl border border-line bg-white p-6">
            <h1 className="text-2xl text-slate-900">O Na Escuta não abriu</h1>
            <p className="mt-2 text-sm text-slate-600">
              Pode ter sido a conexão. Tente de novo; se continuar, avise a administração.
            </p>
            {error.digest && <p className="mt-2 text-sm text-slate-600">Código do erro: {error.digest}</p>}
            <Button onClick={() => retry()} className="mt-6 w-full">
              Tentar de novo
            </Button>
          </div>
        </main>
      </body>
    </html>
  );
}
