"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/Button";

/**
 * O botão de envio de um formulário com Server Action (`<form action={…}>`). Enquanto a ação roda,
 * diz o que está acontecendo ("Entrando…") e não aceita um segundo clique: sem isso o botão fica igual
 * até o redirecionamento, e quem clica de novo manda o formulário outra vez.
 */
export function SubmitButton({ children, pendingLabel, className }: { children: ReactNode; pendingLabel: string; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className={className}>
      {pending ? pendingLabel : children}
    </Button>
  );
}
