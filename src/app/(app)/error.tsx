"use client";

import { useEffect } from "react";
import { AppLink } from "@/components/ui/AppLink";
import { Button, buttonClass } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";

/**
 * Erro inesperado numa tela do app. O menu e a barra de sincronização continuam (o layout fica
 * fora da fronteira de erro), e "Tentar de novo" busca a tela outra vez (`retry`, Next 16.3+).
 */
export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="max-w-xl">
      <title>Erro · Na Escuta</title>
      <PageHeader
        title="Esta tela não abriu"
        description="Pode ter sido a conexão. Tente de novo; se continuar, avise a administração."
      />
      {error.digest && <p className="mt-2 text-sm text-slate-600">Código do erro: {error.digest}</p>}
      <div className="mt-6 flex flex-wrap gap-3">
        <Button onClick={() => retry()}>Tentar de novo</Button>
        <AppLink href="/eventos" className={buttonClass({ variant: "secondary" })}>
          Ir para os eventos
        </AppLink>
      </div>
    </div>
  );
}
