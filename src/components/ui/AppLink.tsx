"use client";

import Link from "next/link";
import type { ComponentProps, MouseEvent } from "react";
import { connectivityMonitor } from "@/lib/sync/connectivity";
import { navigateToDocument } from "@/lib/offline/navigate";

type AppLinkProps = Omit<ComponentProps<typeof Link>, "href"> & { href: string };

/**
 * `next/link` que, SEM conexão efetiva, navega como documento em vez de soft navigation.
 *
 * Por quê: com a rede fora, o Next tenta buscar o payload RSC da próxima tela, falha e cai
 * para "browser navigation" — só que cada prefetch que falha em paralelo reatribui o estado
 * do roteador e re-dispara essa navegação, abortando a anterior. Resultado medido: o clique
 * nunca chegava à tela (o documento era pedido e cancelado em loop). Já a navegação de
 * documento é atendida pelo Service Worker a partir do cache das telas do evento.
 *
 * Com conexão, comportamento idêntico ao `next/link` (transição instantânea, sem recarregar).
 * `connectivityMonitor` começa como "offline" até o primeiro ping responder — nesse curto
 * intervalo o clique vira navegação de documento, que é sempre correta, só um pouco mais lenta.
 */
export function AppLink({ onClick, href, ...props }: AppLinkProps) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (event.defaultPrevented) return;
    if (connectivityMonitor.getState().status === "online") return;
    // Nova aba/janela, download etc.: é do navegador, não nosso.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    event.preventDefault();
    navigateToDocument(href);
  }

  return <Link {...props} href={href} onClick={handleClick} />;
}
