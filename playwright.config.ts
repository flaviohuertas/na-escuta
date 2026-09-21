import { defineConfig, devices } from "@playwright/test";

/**
 * E2E requer a stack real: um Postgres (`docker compose up -d`, ou sem Docker via
 * `embedded-postgres` — ver docs/PLANO.md §11) com `npx prisma migrate deploy --config
 * prisma7.config.ts && npm run db:seed`, e o app rodando em modo PRODUÇÃO (`npm run build &&
 * npm run start`) — o Service Worker fica desligado em `next dev` de propósito (ver
 * next.config.ts), e testar offline sem ele não prova nada.
 *
 * Os specs assumem o banco só com o seed (um evento). Rodam em série no mesmo banco. Já
 * foram executados com o Edge instalado (`channel: "msedge"`, sem baixar o Chromium) e passam
 * 5/5 — ver docs/PLANO.md §13.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "html",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    // Opcional (E2E_WEBKIT=1; exige `npx playwright install webkit`): o menu do celular no motor do
    // Safari, com o iPhone 13 emulado (toque, tela pequena). Não substitui um aparelho de verdade.
    ...(process.env.E2E_WEBKIT
      ? [{ name: "webkit-iphone", use: { ...devices["iPhone 13"] }, testMatch: /navigation\.spec\.ts/, grep: /@celular/ }]
      : []),
  ],
  webServer: {
    command: "npm run build && npm run start",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
