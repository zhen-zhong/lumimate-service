CREATE TYPE "MediaProcessingStatus" AS ENUM ('READY', 'PROCESSING', 'FAILED');

ALTER TABLE "MediaAsset"
  ADD COLUMN "processingStatus" "MediaProcessingStatus" NOT NULL DEFAULT 'READY',
  ADD COLUMN "durationMs" INTEGER,
  ADD COLUMN "width" INTEGER,
  ADD COLUMN "height" INTEGER,
  ADD COLUMN "thumbnailUrl" TEXT,
  ADD COLUMN "processingError" TEXT;

CREATE TABLE "MediaUpload" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "totalBytes" INTEGER NOT NULL,
  "chunkSize" INTEGER NOT NULL,
  "chunkCount" INTEGER NOT NULL,
  "receivedBytes" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'UPLOADING',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MediaUpload_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MediaUploadChunk" (
  "id" TEXT NOT NULL,
  "uploadId" TEXT NOT NULL,
  "index" INTEGER NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MediaUploadChunk_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MediaUpload_userId_status_expiresAt_idx" ON "MediaUpload"("userId", "status", "expiresAt");
CREATE INDEX "MediaUpload_conversationId_createdAt_idx" ON "MediaUpload"("conversationId", "createdAt");
CREATE UNIQUE INDEX "MediaUploadChunk_uploadId_index_key" ON "MediaUploadChunk"("uploadId", "index");
ALTER TABLE "MediaUpload" ADD CONSTRAINT "MediaUpload_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MediaUpload" ADD CONSTRAINT "MediaUpload_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MediaUploadChunk" ADD CONSTRAINT "MediaUploadChunk_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "MediaUpload"("id") ON DELETE CASCADE ON UPDATE CASCADE;
