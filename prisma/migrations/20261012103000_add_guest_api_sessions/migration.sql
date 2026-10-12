-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN "externalId" TEXT;
UPDATE "Conversation" SET "externalId" = "id" WHERE "externalId" IS NULL;
ALTER TABLE "Conversation" ALTER COLUMN "externalId" SET NOT NULL;

-- CreateTable
CREATE TABLE "ApiSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ApiSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApiSession_tokenHash_key" ON "ApiSession"("tokenHash");
CREATE INDEX "ApiSession_userId_revokedAt_idx" ON "ApiSession"("userId", "revokedAt");
CREATE UNIQUE INDEX "Conversation_userId_externalId_key" ON "Conversation"("userId", "externalId");

-- AddForeignKey
ALTER TABLE "ApiSession" ADD CONSTRAINT "ApiSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
