-- Versioned, server-controlled skill plugins. Plugin manifests are data only.
CREATE TYPE "SkillPluginStatus" AS ENUM ('ENABLED', 'DISABLED', 'ARCHIVED');
CREATE TYPE "SkillPluginVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');

CREATE TABLE "SkillPlugin" (
  "id" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "status" "SkillPluginStatus" NOT NULL DEFAULT 'ENABLED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SkillPlugin_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SkillPluginVersion" (
  "id" TEXT NOT NULL,
  "pluginId" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "manifest" JSONB NOT NULL,
  "promptTemplate" TEXT NOT NULL,
  "safetyPolicy" TEXT NOT NULL,
  "status" "SkillPluginVersionStatus" NOT NULL DEFAULT 'DRAFT',
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SkillPluginVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ConversationSkillPlugin" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "pluginId" TEXT NOT NULL,
  "pluginVersionId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "userConfig" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ConversationSkillPlugin_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "AgentRun" ADD COLUMN "pluginVersionId" TEXT;

CREATE UNIQUE INDEX "SkillPluginVersion_pluginId_version_key" ON "SkillPluginVersion"("pluginId", "version");
CREATE UNIQUE INDEX "ConversationSkillPlugin_conversationId_pluginId_key" ON "ConversationSkillPlugin"("conversationId", "pluginId");
CREATE INDEX "SkillPlugin_status_updatedAt_idx" ON "SkillPlugin"("status", "updatedAt");
CREATE INDEX "SkillPluginVersion_pluginId_status_publishedAt_idx" ON "SkillPluginVersion"("pluginId", "status", "publishedAt");
CREATE INDEX "ConversationSkillPlugin_conversationId_enabled_priority_idx" ON "ConversationSkillPlugin"("conversationId", "enabled", "priority");
CREATE INDEX "ConversationSkillPlugin_pluginVersionId_idx" ON "ConversationSkillPlugin"("pluginVersionId");
CREATE INDEX "AgentRun_pluginVersionId_createdAt_idx" ON "AgentRun"("pluginVersionId", "createdAt");

ALTER TABLE "SkillPluginVersion" ADD CONSTRAINT "SkillPluginVersion_pluginId_fkey" FOREIGN KEY ("pluginId") REFERENCES "SkillPlugin"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConversationSkillPlugin" ADD CONSTRAINT "ConversationSkillPlugin_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConversationSkillPlugin" ADD CONSTRAINT "ConversationSkillPlugin_pluginId_fkey" FOREIGN KEY ("pluginId") REFERENCES "SkillPlugin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConversationSkillPlugin" ADD CONSTRAINT "ConversationSkillPlugin_pluginVersionId_fkey" FOREIGN KEY ("pluginVersionId") REFERENCES "SkillPluginVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_pluginVersionId_fkey" FOREIGN KEY ("pluginVersionId") REFERENCES "SkillPluginVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
