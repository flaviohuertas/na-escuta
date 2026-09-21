"use client";

import { useEffect, type RefObject } from "react";

/**
 * Depois de um envio recusado, leva o foco ao primeiro campo com erro (`aria-invalid="true"`, que o
 * `Field` marca). Sem isso, quem usa teclado ou leitor de tela fica no botão de enviar sem saber o que
 * corrigir. `errors` é o mapa de erros por campo do formulário; o efeito roda quando ele muda.
 */
export function useFocusFirstInvalid(formRef: RefObject<HTMLFormElement | null>, errors: object | null | undefined) {
  useEffect(() => {
    if (!errors) return;
    const hasError = Object.values(errors).some((value) => (Array.isArray(value) ? value.length > 0 : Boolean(value)));
    if (!hasError) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [errors, formRef]);
}
