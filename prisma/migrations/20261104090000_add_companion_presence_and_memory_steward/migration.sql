ALTER TABLE "Memory"
  ADD COLUMN "memoryKey" TEXT,
  ADD COLUMN "archivedAt" TIMESTAMP(3),
  ADD COLUMN "supersededAt" TIMESTAMP(3),
  ADD COLUMN "supersededById" TEXT;

CREATE INDEX "Memory_conversationId_memoryKey_status_idx"
  ON "Memory"("conversationId", "memoryKey", "status");

CREATE TABLE "CompanionPresence" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "activityKey" TEXT NOT NULL,
  "activityLabel" TEXT NOT NULL,
  "nextPlan" TEXT,
  "source" TEXT NOT NULL,
  "lastActivityAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CompanionPresence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompanionPresence_conversationId_key" ON "CompanionPresence"("conversationId");
CREATE INDEX "CompanionPresence_userId_updatedAt_idx" ON "CompanionPresence"("userId", "updatedAt");
CREATE INDEX "CompanionPresence_conversationId_expiresAt_idx" ON "CompanionPresence"("conversationId", "expiresAt");

CREATE TABLE "CompanionLifeEvent" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "sourceMessageId" TEXT,
  "eventType" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "truth" TEXT NOT NULL,
  "metadata" JSONB,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CompanionLifeEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CompanionLifeEvent_conversationId_occurredAt_idx" ON "CompanionLifeEvent"("conversationId", "occurredAt");
CREATE INDEX "CompanionLifeEvent_userId_occurredAt_idx" ON "CompanionLifeEvent"("userId", "occurredAt");
CREATE INDEX "CompanionLifeEvent_sourceMessageId_idx" ON "CompanionLifeEvent"("sourceMessageId");

ALTER TABLE "CompanionPresence"
  ADD CONSTRAINT "CompanionPresence_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompanionPresence"
  ADD CONSTRAINT "CompanionPresence_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompanionLifeEvent"
  ADD CONSTRAINT "CompanionLifeEvent_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompanionLifeEvent"
  ADD CONSTRAINT "CompanionLifeEvent_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
