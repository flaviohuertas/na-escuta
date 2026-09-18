import { AppDatabase } from "./schema";

let instance: AppDatabase | null = null;

/**
 * Retorna o singleton do banco local (IndexedDB via Dexie). Só pode ser
 * chamado no browser — este projeto nunca deve importar isso em código que
 * roda durante SSR/Server Components; toda a árvore de telas operacionais
 * (tarefas/checklists/ocorrências) é Client Component por natureza (interação
 * offline), então essa fronteira é natural.
 */
export function getDb(): AppDatabase {
  if (typeof window === "undefined" || typeof indexedDB === "undefined") {
    throw new Error(
      "getDb() só pode ser usado no browser (IndexedDB não existe durante SSR)."
    );
  }
  if (!instance) {
    instance = new AppDatabase();
  }
  return instance;
}

/** Uso exclusivo de testes: permite injetar/related uma instância isolada por teste. */
export function resetDbInstanceForTests(): void {
  instance = null;
}

/**
 * Limpeza segura do dispositivo (logout): apaga todo o banco local —
 * sessão offline, outbox, entidades, conflitos. Chame só depois de o usuário
 * confirmar (e, se havia pendências, exportar) — não há como desfazer.
 */
export async function wipeLocalDatabase(): Promise<void> {
  const db = getDb();
  db.close();
  await db.delete();
  instance = null;
}

export type { AppDatabase } from "./schema";
export * from "./schema";
