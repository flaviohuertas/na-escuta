import { NextResponse } from "next/server";
import { z } from "zod";
import { AdminActionError } from "@/server/errors";
import {
  EventForbiddenError,
  EventNotFoundError,
  EventVersionConflictError,
} from "@/server/events/event.service";

/** 422 com os erros por campo, no formato que os formulários sabem mostrar ao lado de cada campo. */
export function validationErrorResponse(error: z.ZodError) {
  return NextResponse.json(
    { error: "Confira os campos destacados.", fieldErrors: z.flattenError(error).fieldErrors },
    { status: 422 }
  );
}

/** Traduz os erros de negócio em respostas HTTP; devolve `null` para o que não é deles (a rota relança). */
export function domainErrorResponse(err: unknown): NextResponse | null {
  if (err instanceof AdminActionError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (err instanceof EventNotFoundError) {
    return NextResponse.json({ error: err.message }, { status: 404 });
  }
  if (err instanceof EventForbiddenError) {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  if (err instanceof EventVersionConflictError) {
    return NextResponse.json({ error: err.message, event: err.current }, { status: 409 });
  }
  return null;
}

/** Sessão + corpo JSON válido, ou a resposta de erro pronta. Evita repetir o mesmo cabeçalho em toda rota. */
export async function readJsonBody<S extends z.ZodType>(
  request: Request,
  schema: S
): Promise<{ ok: true; data: z.infer<S> } | { ok: false; response: NextResponse }> {
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return { ok: false, response: validationErrorResponse(parsed.error) };
  return { ok: true, data: parsed.data };
}
