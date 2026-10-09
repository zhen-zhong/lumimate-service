-- Persist confirmation-gated Agent tool calls and their execution audit trail.
CREATE TYPE "AgentRunStatus" AS ENUM ('AWAITING_CONFIRMATION', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');
CREATE TYPE "AgentToolPermission" AS ENUM ('READ', 'WRITE', 'SENSITIVE');

CREATE TABLE "AgentRun" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "toolName" TEXT NOT NULL,
  "permission" "AgentToolPermission" NOT NULL,
  "status" "AgentRunStatus" NOT NULL DEFAULT 'AWAITING_CONFIRMATION',
  "input" JSONB NOT NULL,
  "output" JSONB,
  "sourceMessageId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "confirmedAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentRun_idempotencyKey_key" ON "AgentRun"("idempotencyKey");
CREATE INDEX "AgentRun_conversationId_status_createdAt_idx" ON "AgentRun"("conversationId", "status", "createdAt");
CREATE INDEX "AgentRun_userId_toolName_status_idx" ON "AgentRun"("userId", "toolName", "status");
CREATE INDEX "AgentRun_sourceMessageId_idx" ON "AgentRun"("sourceMessageId");

ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
