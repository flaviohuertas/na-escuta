import type { Metadata } from "next";
import { OfflineFallback } from "@/components/offline/OfflineFallback";

export const metadata: Metadata = { title: "Sem conexão" };

/**
 * Fallback offline do Service Worker (ver `OFFLINE_FALLBACK_URL`). PÚBLICA de propósito: o SW a
 * pré-carrega ao instalar, na tela de login, sem sessão — se pedisse login, o pré-cache receberia
 * um redirecionamento e a instalação inteira do SW falharia.
 */
export default function OfflinePage() {
  return <OfflineFallback />;
}
