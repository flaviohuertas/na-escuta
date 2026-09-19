import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [react()],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "jsdom",
          include: ["tests/unit/**/*.test.{ts,tsx}"],
          setupFiles: ["./tests/setup/vitest.setup.ts"],
          restoreMocks: true,
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          restoreMocks: true,
          // Todos os arquivos compartilham um único Postgres e cada teste faz
          // TRUNCATE no beforeEach — em paralelo, um arquivo apaga os dados do outro
          // no meio do setup (violações de FK aleatórias).
          fileParallelism: false,
        },
      },
    ],
  },
});
