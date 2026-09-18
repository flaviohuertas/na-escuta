import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  swSrc: "src/worker/service-worker.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
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
