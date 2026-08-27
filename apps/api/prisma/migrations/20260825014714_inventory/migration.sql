-- CreateEnum
CREATE TYPE "Unit" AS ENUM ('G', 'MG', 'KG', 'ML', 'L', 'UNIT');

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "madeById" TEXT NOT NULL,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reagent" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "casNumber" TEXT NOT NULL,
    "reference" TEXT,
    "description" TEXT,
    "dataSheetUrl" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "madeById" TEXT NOT NULL,

    CONSTRAINT "Reagent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReagentBatch" (
    "id" TEXT NOT NULL,
    "lotNumber" TEXT NOT NULL,
    "entryDate" TIMESTAMP(3) NOT NULL,
    "expirationDate" TIMESTAMP(3),
    "initialStock" DECIMAL(12,4) NOT NULL,
    "currentStock" DECIMAL(12,4) NOT NULL,
    "unit" "Unit" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "reagentId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "madeById" TEXT NOT NULL,

    CONSTRAINT "ReagentBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Consumption" (
    "id" TEXT NOT NULL,
    "consumedAt" TIMESTAMP(3) NOT NULL,
    "quantity" DECIMAL(12,4) NOT NULL,
    "purpose" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "voidReason" TEXT,
    "voidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "batchId" TEXT NOT NULL,
    "voidedById" TEXT,
    "madeById" TEXT NOT NULL,

    CONSTRAINT "Consumption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Location_name_key" ON "Location"("name");

-- CreateIndex
CREATE INDEX "Location_active_idx" ON "Location"("active");

-- CreateIndex
CREATE INDEX "Reagent_name_idx" ON "Reagent"("name");

-- CreateIndex
CREATE INDEX "Reagent_casNumber_idx" ON "Reagent"("casNumber");

-- CreateIndex
CREATE INDEX "Reagent_active_idx" ON "Reagent"("active");

-- CreateIndex
CREATE INDEX "ReagentBatch_reagentId_idx" ON "ReagentBatch"("reagentId");

-- CreateIndex
CREATE INDEX "ReagentBatch_expirationDate_idx" ON "ReagentBatch"("expirationDate");

-- CreateIndex
CREATE INDEX "ReagentBatch_locationId_idx" ON "ReagentBatch"("locationId");

-- CreateIndex
CREATE INDEX "ReagentBatch_active_idx" ON "ReagentBatch"("active");

-- CreateIndex
CREATE INDEX "Consumption_batchId_idx" ON "Consumption"("batchId");

-- CreateIndex
CREATE INDEX "Consumption_consumedAt_idx" ON "Consumption"("consumedAt");

-- CreateIndex
CREATE INDEX "Consumption_active_idx" ON "Consumption"("active");

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_madeById_fkey" FOREIGN KEY ("madeById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reagent" ADD CONSTRAINT "Reagent_madeById_fkey" FOREIGN KEY ("madeById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReagentBatch" ADD CONSTRAINT "ReagentBatch_reagentId_fkey" FOREIGN KEY ("reagentId") REFERENCES "Reagent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReagentBatch" ADD CONSTRAINT "ReagentBatch_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReagentBatch" ADD CONSTRAINT "ReagentBatch_madeById_fkey" FOREIGN KEY ("madeById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consumption" ADD CONSTRAINT "Consumption_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ReagentBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consumption" ADD CONSTRAINT "Consumption_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consumption" ADD CONSTRAINT "Consumption_madeById_fkey" FOREIGN KEY ("madeById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
