CREATE TYPE "MemoryLayer" AS ENUM ('USER_FACT');
ALTER TYPE "CompanionEventSubject" ADD VALUE IF NOT EXISTS 'SHARED_EPISODE';

ALTER TABLE "Memory"
ADD COLUMN "layer" "MemoryLayer" NOT NULL DEFAULT 'USER_FACT';

CREATE TABLE "SharedEpisode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "sourceMessageId" TEXT,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CONFIRMED',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SharedEpisode_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "SharedEpisode" ADD CONSTRAINT "SharedEpisode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SharedEpisode" ADD CONSTRAINT "SharedEpisode_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "SharedEpisode_conversationId_status_occurredAt_idx" ON "SharedEpisode"("conversationId", "status", "occurredAt");
CREATE INDEX "SharedEpisode_userId_updatedAt_idx" ON "SharedEpisode"("userId", "updatedAt");
CREATE INDEX "SharedEpisode_sourceMessageId_idx" ON "SharedEpisode"("sourceMessageId");
