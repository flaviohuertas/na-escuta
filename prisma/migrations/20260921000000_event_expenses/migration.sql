-- CreateTable
CREATE TABLE "event_expenses" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "supplier" TEXT,
    "amountCents" INTEGER NOT NULL,
    "expenseDate" DATE NOT NULL,
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "voidedAt" TIMESTAMP(3),
    "voidedBy" TEXT,
    "voidReason" TEXT,

    CONSTRAINT "event_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "event_expenses_eventId_voidedAt_idx" ON "event_expenses"("eventId", "voidedAt");

-- CreateIndex
CREATE INDEX "event_expenses_companyId_idx" ON "event_expenses"("companyId");

-- AddForeignKey
ALTER TABLE "event_expenses" ADD CONSTRAINT "event_expenses_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_expenses" ADD CONSTRAINT "event_expenses_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

