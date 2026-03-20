-- CreateEnum
CREATE TYPE "BatchStatus" AS ENUM ('SAMPLE_QUEUED', 'SAMPLE_RUNNING', 'SAMPLE_REVIEW', 'BULK_QUEUED', 'BULK_RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "PromptPhase" AS ENUM ('SAMPLE', 'BULK');

-- CreateTable
CREATE TABLE "ProductionBatch" (
    "id" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "status" "BatchStatus" NOT NULL DEFAULT 'SAMPLE_QUEUED',
    "sampleSizePerDirection" INTEGER NOT NULL DEFAULT 2,
    "totalPrompts" INTEGER NOT NULL DEFAULT 0,
    "samplePrompts" INTEGER NOT NULL DEFAULT 0,
    "bulkPrompts" INTEGER NOT NULL DEFAULT 0,
    "sampleDispatchedAt" TIMESTAMP(3),
    "sampleCompletedAt" TIMESTAMP(3),
    "bulkDispatchedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionBatch_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Prompt"
ADD COLUMN     "productionBatchId" TEXT,
ADD COLUMN     "productionPhase" "PromptPhase";

-- AddForeignKey
ALTER TABLE "ProductionBatch" ADD CONSTRAINT "ProductionBatch_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "VideoStrategy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prompt" ADD CONSTRAINT "Prompt_productionBatchId_fkey" FOREIGN KEY ("productionBatchId") REFERENCES "ProductionBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
