import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  swSrc: "src/worker/service-worker.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
  // O padrão do Serwist é dar `location.reload()` a cada evento `online` do navegador.
  // Num app offline-first isso é um risco: com sinal fraco em campo `online`/`offline`
  // oscilam, e a página recarregaria sozinha — perdendo o que a pessoa está digitando e
  // abortando navegações em andamento (medido: o clique em "Tarefas" offline era cancelado
  // em loop). A reconexão já é tratada por `ConnectivityMonitor` + sincronização.
  reloadOnOnline: false,
});

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Next 16 usa Turbopack por padrão; @serwist/next ainda injeta uma config
  // webpack (para o build do service worker). Um `turbopack: {}` explícito
  // reconhece isso e evita o erro de segurança do Next sobre config webpack
  // "órfã" sob Turbopack.
  turbopack: {},
};

export default withSerwist(nextConfig);
