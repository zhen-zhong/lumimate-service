ALTER TABLE "Conversation"
ADD COLUMN "personaProfile" JSONB;

ALTER TABLE "Conversation"
ADD COLUMN "personaVersion" INTEGER NOT NULL DEFAULT 1;
