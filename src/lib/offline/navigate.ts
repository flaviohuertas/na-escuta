/**
 * Navegação de DOCUMENTO (recarrega a página): passa pelo Service Worker, que serve a tela
 * do cache quando não há rede. Isolada num módulo para poder ser trocada nos testes —
 * o jsdom não implementa `location.assign`.
 */
export function navigateToDocument(href: string): void {
  window.location.assign(href);
}
