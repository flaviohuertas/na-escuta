import { NextResponse } from "next/server";

/**
 * Usado pelo ConnectivityMonitor para detectar "online efetivo" — não
 * depende de banco (não pode falhar por causa do Postgres estar fora do ar
 * quando o objetivo é só medir se o SERVIDOR NEXT está alcançável).
 */
export async function GET() {
  return NextResponse.json({ ok: true, serverTime: new Date().toISOString() });
}
