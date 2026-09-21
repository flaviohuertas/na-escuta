import { NextResponse } from "next/server";
import { SupplierArchiveSchema } from "@/lib/domain/supplier.schema";
import { setSupplierArchived } from "@/server/suppliers/supplier.service";
import { domainErrorResponse, readJsonBody } from "@/server/http/responses";
import { supplierSession } from "@/server/http/supplier-session";

/** Arquiva ou reativa um fornecedor (ele nunca é apagado; os vínculos que já existem continuam). */
export async function POST(request: Request, { params }: { params: Promise<{ supplierId: string }> }) {
  const session = await supplierSession();
  if (!session.ok) return session.response;
  const { supplierId } = await params;
  const body = await readJsonBody(request, SupplierArchiveSchema);
  if (!body.ok) return body.response;

  try {
    const supplier = await setSupplierArchived({
      userId: session.userId,
      companyId: session.companyId,
      supplierId,
      archived: body.data.archived,
      baseVersion: body.data.baseVersion,
    });
    return NextResponse.json({ supplier });
  } catch (err) {
    const response = domainErrorResponse(err);
    if (response) return response;
    throw err;
  }
}
