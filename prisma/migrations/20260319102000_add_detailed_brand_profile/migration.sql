-- AlterTable
ALTER TABLE "BrandProfile"
ADD COLUMN     "detailedProfile" JSONB,
ADD COLUMN     "brandProfileMarkdown" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "strategySystemPrompt" TEXT NOT NULL DEFAULT '';
