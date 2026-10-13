CREATE TYPE "CompanionEventSubject" AS ENUM ('MEMORY', 'AGENT_RUN', 'AGENT_INTENT', 'PUSH_DELIVERY');

CREATE TABLE "CompanionEvent" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "conversationId" TEXT,
  "sourceMessageId" TEXT,
  "subject" "CompanionEventSubject" NOT NULL,
  "subjectId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "detail" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CompanionEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CompanionEvent_userId_createdAt_idx" ON "CompanionEvent"("userId", "createdAt");
CREATE INDEX "CompanionEvent_conversationId_createdAt_idx" ON "CompanionEvent"("conversationId", "createdAt");
CREATE INDEX "CompanionEvent_subject_subjectId_createdAt_idx" ON "CompanionEvent"("subject", "subjectId", "createdAt");
ALTER TABLE "CompanionEvent" ADD CONSTRAINT "CompanionEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompanionEvent" ADD CONSTRAINT "CompanionEvent_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompanionEvent" ADD CONSTRAINT "CompanionEvent_sourceMessageId_fkey" FOREIGN KEY ("sourceMessageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;
