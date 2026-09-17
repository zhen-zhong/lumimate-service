-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "agentName" TEXT NOT NULL DEFAULT 'LumiMate',
ADD COLUMN     "agentProfile" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "contextMessageLimit" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "responseStyle" TEXT NOT NULL DEFAULT '温和、简洁';
