import { NextResponse } from "next/server";
import { SupplierUpdateSchema } from "@/lib/domain/supplier.schema";
import { updateSupplier } from "@/server/suppliers/supplier.service";
import { domainErrorResponse, readJsonBody } from "@/server/http/responses";
import { supplierSession } from "@/server/http/supplier-session";

/** Edita o cadastro do fornecedor. 409 se está arquivado, se outra pessoa mexeu antes (versão) ou se o documento já é de outro cadastro. */
export async function PATCH(request: Request, { params }: { params: Promise<{ supplierId: string }> }) {
  const session = await supplierSession();
  if (!session.ok) return session.response;
  const { supplierId } = await params;
  const body = await readJsonBody(request, SupplierUpdateSchema);
  if (!body.ok) return body.response;

  try {
    const supplier = await updateSupplier({ userId: session.userId, companyId: session.companyId, supplierId, input: body.data });
    return NextResponse.json({ supplier });
  } catch (err) {
    const response = domainErrorResponse(err);
    if (response) return response;
    throw err;
  }
}
