import { NextResponse } from "next/server";
import { SupplierInputSchema } from "@/lib/domain/supplier.schema";
import { createSupplier } from "@/server/suppliers/supplier.service";
import { domainErrorResponse, readJsonBody } from "@/server/http/responses";
import { supplierSession } from "@/server/http/supplier-session";

/** Cadastra um fornecedor. Exige conexão (é uma ação de gestão). 409 se o documento já é de outro cadastro. */
export async function POST(request: Request) {
  const session = await supplierSession();
  if (!session.ok) return session.response;
  const body = await readJsonBody(request, SupplierInputSchema);
  if (!body.ok) return body.response;

  try {
    const supplier = await createSupplier({ userId: session.userId, companyId: session.companyId, input: body.data });
    return NextResponse.json({ supplier }, { status: 201 });
  } catch (err) {
    const response = domainErrorResponse(err);
    if (response) return response;
    throw err;
  }
}
