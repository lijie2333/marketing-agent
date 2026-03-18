-- AlterTable
ALTER TABLE "BrandProfile" ADD COLUMN     "logoUrl" TEXT;

-- AlterTable
ALTER TABLE "Prompt" ADD COLUMN     "referenceImageUrls" TEXT[] DEFAULT ARRAY[]::TEXT[];
