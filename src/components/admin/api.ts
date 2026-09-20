export const OFFLINE_MESSAGE = "Sem conexão. Esta ação exige internet — tente de novo quando estiver conectado.";

export type ApiResult<T> = { ok: true; data: T } | { ok: false; message: string; status: number | null };

/**
 * Chamada de API das telas de administração. Estas ações exigem conexão e, sem ela, dizem isso
 * em vez de ficarem penduradas ou fingirem que deram certo. Nunca lança: devolve o erro já em
 * texto para a tela mostrar como está.
 */
export async function callApi<T>(method: "POST" | "PATCH" | "PUT", url: string, body?: unknown): Promise<ApiResult<T>> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { ok: false, message: OFFLINE_MESSAGE, status: null };
  }
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    // `fetch` só rejeita quando a requisição nem chegou ao servidor.
    return { ok: false, message: OFFLINE_MESSAGE, status: null };
  }

  const json = (await res.json().catch(() => null)) as
    | (T & { error?: string; fieldErrors?: Record<string, string[]> })
    | null;
  if (res.status === 401) {
    return { ok: false, message: "Sua sessão expirou. Entre de novo e repita a ação.", status: 401 };
  }
  if (!res.ok) {
    const firstFieldError = json?.fieldErrors ? Object.values(json.fieldErrors).flat()[0] : undefined;
    return {
      ok: false,
      message: firstFieldError ?? json?.error ?? "Não foi possível concluir a ação.",
      status: res.status,
    };
  }
  return { ok: true, data: json as T };
}
