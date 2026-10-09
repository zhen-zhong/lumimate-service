CREATE TABLE "KnowledgeBase" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "KnowledgeBase_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "KnowledgeDocument"
  ADD COLUMN "knowledgeBaseId" TEXT,
  ADD COLUMN "sizeBytes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "processedAt" TIMESTAMP(3),
  ADD COLUMN "failedAt" TIMESTAMP(3),
  ADD COLUMN "failureReason" TEXT;

CREATE UNIQUE INDEX "KnowledgeBase_userId_name_key" ON "KnowledgeBase"("userId", "name");
CREATE INDEX "KnowledgeBase_userId_updatedAt_idx" ON "KnowledgeBase"("userId", "updatedAt");
CREATE INDEX "KnowledgeDocument_knowledgeBaseId_status_idx" ON "KnowledgeDocument"("knowledgeBaseId", "status");

ALTER TABLE "KnowledgeBase"
  ADD CONSTRAINT "KnowledgeBase_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "KnowledgeDocument"
  ADD CONSTRAINT "KnowledgeDocument_knowledgeBaseId_fkey"
  FOREIGN KEY ("knowledgeBaseId") REFERENCES "KnowledgeBase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
