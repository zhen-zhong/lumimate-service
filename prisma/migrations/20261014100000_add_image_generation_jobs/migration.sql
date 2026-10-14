CREATE TYPE "ImageGenerationAction" AS ENUM ('GENERATE', 'EDIT');
CREATE TYPE "ImageGenerationJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');

CREATE TABLE "ImageGenerationJob" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "sourceMessageId" TEXT NOT NULL,
  "assistantMessageId" TEXT NOT NULL,
  "action" "ImageGenerationAction" NOT NULL,
  "request" TEXT NOT NULL,
  "imageModelId" TEXT NOT NULL,
  "chatModelId" TEXT NOT NULL,
  "context" JSONB,
  "sourceImageUrl" TEXT,
  "sourceImageMimeType" TEXT,
  "status" "ImageGenerationJobStatus" NOT NULL DEFAULT 'QUEUED',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ImageGenerationJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ImageGenerationJob_assistantMessageId_key" ON "ImageGenerationJob"("assistantMessageId");
CREATE INDEX "ImageGenerationJob_userId_status_createdAt_idx" ON "ImageGenerationJob"("userId", "status", "createdAt");
CREATE INDEX "ImageGenerationJob_conversationId_createdAt_idx" ON "ImageGenerationJob"("conversationId", "createdAt");

ALTER TABLE "ImageGenerationJob" ADD CONSTRAINT "ImageGenerationJob_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ImageGenerationJob" ADD CONSTRAINT "ImageGenerationJob_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ImageGenerationJob" ADD CONSTRAINT "ImageGenerationJob_sourceMessageId_fkey"
  FOREIGN KEY ("sourceMessageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ImageGenerationJob" ADD CONSTRAINT "ImageGenerationJob_assistantMessageId_fkey"
  FOREIGN KEY ("assistantMessageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
