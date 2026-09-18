import { defineConfig, devices } from "@playwright/test";

/**
 * E2E requer a stack real: `docker compose up -d && npx prisma migrate
 * deploy && npm run db:seed` e o app rodando em modo PRODUÇÃO (`npm run
 * build && npm run start`) — o Service Worker fica desligado em `next dev`
 * de propósito (ver next.config.ts), e testar offline sem ele não prova
 * nada. Não executado nesta sessão de desenvolvimento (sem Docker/Postgres,
 * sem browsers do Playwright instalados) — ver docs/PLANO.md.
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
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run build && npm run start",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
