-- Add companion memory, relationship state and confirmable agent intents.
CREATE TYPE "MemoryCategory" AS ENUM ('PREFERENCE', 'RELATIONSHIP', 'COMMITMENT', 'PLACE', 'EVENT', 'FACT');
CREATE TYPE "MemoryStatus" AS ENUM ('CANDIDATE', 'CONFIRMED', 'ARCHIVED', 'DELETED');
CREATE TYPE "AgentIntentType" AS ENUM ('REMINDER', 'FOLLOW_UP', 'PROACTIVE');
CREATE TYPE "AgentIntentStatus" AS ENUM ('AWAITING_CONFIRMATION', 'SCHEDULED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED');

CREATE TABLE "Memory" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "conversationId" TEXT,
  "category" "MemoryCategory" NOT NULL,
  "status" "MemoryStatus" NOT NULL DEFAULT 'CANDIDATE',
  "content" TEXT NOT NULL,
  "normalizedValue" TEXT,
  "sourceMessageId" TEXT,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  "visibility" TEXT NOT NULL DEFAULT 'private',
  "expiresAt" TIMESTAMP(3),
  "confirmedAt" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Memory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Relationship" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "preferredName" TEXT,
  "relationshipSummary" TEXT NOT NULL DEFAULT '',
  "communicationStyle" TEXT NOT NULL DEFAULT '',
  "emotionSummary" TEXT NOT NULL DEFAULT '',
  "lastInteractionAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Relationship_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentIntent" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "conversationId" TEXT,
  "type" "AgentIntentType" NOT NULL,
  "title" TEXT NOT NULL,
  "payload" JSONB,
  "timezone" TEXT NOT NULL,
  "dueAt" TIMESTAMP(3) NOT NULL,
  "status" "AgentIntentStatus" NOT NULL DEFAULT 'AWAITING_CONFIRMATION',
  "idempotencyKey" TEXT NOT NULL,
  "sourceMessageId" TEXT,
  "confirmedAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AgentIntent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProactivePolicy" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "quietHoursStart" TEXT,
  "quietHoursEnd" TEXT,
  "dailyLimit" INTEGER NOT NULL DEFAULT 1,
  "minimumIntervalMinutes" INTEGER NOT NULL DEFAULT 720,
  "lastProactiveAt" TIMESTAMP(3),
  "dailyUsageDate" TEXT,
  "dailyUsageCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProactivePolicy_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Relationship_conversationId_key" ON "Relationship"("conversationId");
CREATE UNIQUE INDEX "AgentIntent_idempotencyKey_key" ON "AgentIntent"("idempotencyKey");
CREATE UNIQUE INDEX "ProactivePolicy_userId_key" ON "ProactivePolicy"("userId");
CREATE INDEX "Memory_userId_status_updatedAt_idx" ON "Memory"("userId", "status", "updatedAt");
CREATE INDEX "Memory_conversationId_status_idx" ON "Memory"("conversationId", "status");
CREATE INDEX "Memory_sourceMessageId_idx" ON "Memory"("sourceMessageId");
CREATE INDEX "Relationship_userId_updatedAt_idx" ON "Relationship"("userId", "updatedAt");
CREATE INDEX "AgentIntent_userId_status_dueAt_idx" ON "AgentIntent"("userId", "status", "dueAt");
CREATE INDEX "AgentIntent_conversationId_status_dueAt_idx" ON "AgentIntent"("conversationId", "status", "dueAt");

ALTER TABLE "Memory" ADD CONSTRAINT "Memory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Memory" ADD CONSTRAINT "Memory_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Relationship" ADD CONSTRAINT "Relationship_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Relationship" ADD CONSTRAINT "Relationship_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentIntent" ADD CONSTRAINT "AgentIntent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentIntent" ADD CONSTRAINT "AgentIntent_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProactivePolicy" ADD CONSTRAINT "ProactivePolicy_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
