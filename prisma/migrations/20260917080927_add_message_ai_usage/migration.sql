-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "inputTokens" INTEGER,
ADD COLUMN     "modelId" TEXT,
ADD COLUMN     "modelLabel" TEXT,
ADD COLUMN     "outputTokens" INTEGER,
ADD COLUMN     "protocol" TEXT,
ADD COLUMN     "provider" TEXT;
