import { NextResponse } from "next/server";
import { z } from "zod";
import {
  EventForbiddenError,
  EventNotFoundError,
  EventVersionConflictError,
} from "./event.service";

/** 422 com os erros por campo, no formato que o formulário sabe mostrar ao lado de cada campo. */
export function validationErrorResponse(error: z.ZodError) {
  return NextResponse.json(
    { error: "Confira os campos destacados.", fieldErrors: z.flattenError(error).fieldErrors },
    { status: 422 }
  );
}

/** Traduz os erros de negócio de `event.service` em respostas HTTP; devolve `null` para o que não é deles. */
export function eventErrorResponse(err: unknown): NextResponse | null {
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
