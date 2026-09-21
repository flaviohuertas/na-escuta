-- CreateEnum
CREATE TYPE "SupplierKind" AS ENUM ('COMPANY', 'PERSON');

-- AlterTable
ALTER TABLE "budget_items" ADD COLUMN     "supplierId" TEXT;

-- AlterTable
ALTER TABLE "event_expenses" ADD COLUMN     "supplierId" TEXT;

-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "SupplierKind" NOT NULL DEFAULT 'COMPANY',
    "document" TEXT,
    "contactName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "category" TEXT,
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "suppliers_companyId_name_idx" ON "suppliers"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_companyId_document_key" ON "suppliers"("companyId", "document");

-- CreateIndex
CREATE INDEX "budget_items_supplierId_idx" ON "budget_items"("supplierId");

-- CreateIndex
CREATE INDEX "event_expenses_supplierId_idx" ON "event_expenses"("supplierId");

-- AddForeignKey
ALTER TABLE "budget_items" ADD CONSTRAINT "budget_items_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_expenses" ADD CONSTRAINT "event_expenses_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

