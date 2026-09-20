/**
 * Erro de regra de negócio das ações administrativas (equipe, acessos, senha), já com o status
 * HTTP que a rota devolve e uma mensagem que a tela pode mostrar como está.
 * 403 sem permissão · 404 não existe · 409 conflita com o estado atual · 422 dado que não serve.
 */
export class AdminActionError extends Error {
  constructor(
    message: string,
    public status: 403 | 404 | 409 | 422
  ) {
    super(message);
    this.name = "AdminActionError";
  }
}
