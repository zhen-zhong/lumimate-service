# Skill Plugin Architecture

## Goal

LumiMate allows multiple domain skills without allowing a skill package to execute arbitrary code or silently expand its data access. A skill is a versioned server-side configuration package, not an npm package, shell script, or unrestricted agent.

## Core models

```text
SkillPlugin
  id / displayName / status / latestVersionId

SkillPluginVersion
  pluginId / version / manifest / promptTemplate / safetyPolicy / publishedAt

ConversationSkillPlugin
  conversationId / pluginVersionId / enabled / priority / userConfig

SkillKnowledgeBinding
  pluginVersionId / knowledgeBaseId / retrievalPolicy
```

`ConversationSkillPlugin` pins a version. Publishing a new plugin version never changes an existing conversation. The user must explicitly upgrade, disable, or remove it.

## Manifest boundary

Each reviewed manifest declares only data:

```json
{
  "id": "relationship-coach",
  "version": "1.0.0",
  "promptTemplate": "relationship-coach-v1",
  "knowledgeBindings": ["relationship-science-v1"],
  "toolGrants": ["knowledge.search", "task.create"],
  "memoryCategories": ["relationship", "commitment", "preference"],
  "limits": { "maxPromptChars": 6000, "maxRetrievedChunks": 5, "maxToolCalls": 2 },
  "riskPolicy": "relationship-safety-v1",
  "ui": { "icon": "heart.text.square", "category": "陪伴" }
}
```

Manifest does not contain executable JavaScript, arbitrary URLs, shell commands, database query text, model API keys, or user secrets.

## Effective runtime policy

```text
global tool allowlist
  ∩ plugin manifest tool grants
  ∩ conversation settings
  ∩ user consent
  ∩ current device/location/media permission
  = effective tool set
```

`READ` tools may run automatically only after this intersection succeeds. `WRITE` and `SENSITIVE` tools always create a confirmation-gated `AgentRun`. 当前核心陪伴的提醒解析属于内置策略；领域插件声明同一工具时，最高优先级的已启用插件获得该次 `AgentRun` 归属。

插件记忆读取默认关闭。开启后，模型才可收到该插件 manifest 声明类别中的已确认记忆；关闭时，同类别长期记忆和 `RELATIONSHIP` 关系资料都会从该次模型上下文排除。关闭插件也会停止其全部提示词、工具与记忆使用。

The `AgentRun`, generated message metadata, push delivery, evaluation result, and audit log must persist `pluginId` and `pluginVersion`.

## Multiple-plugin composition

1. Load core companion policy first.
2. Load enabled plugin manifests in explicit priority order.
3. Retrieve only each plugin's approved knowledge bindings.
4. Apply total context and tool budgets before model invocation.
5. Reject incompatible policy combinations instead of concatenating unrestricted prompts.

Only one plugin owns a tool call. When two plugins propose the same side-effecting action, create one deduplicated candidate and require a single user confirmation.

## First plugin: relationship-coach

`relationship-coach` may borrow high-level workflow from `goutoujunshi`:

```text
情绪承接 → 事实/推测/未知分离 → 关系判断 → 可执行下一步 → 观察窗口与停止条件
```

It must not claim diagnosis, legal advice, or certainty about another person's intent. Violence, coercion, stalking, fraud, self-harm, or acute danger bypass ordinary relationship advice and enter a safety escalation flow. Knowledge sources need independent review, citation, and versioning before import.

## Rollout sequence

1. Database models and server-side Plugin Registry.
2. Manifest validator and policy resolver.
3. Conversation binding API and App plugin settings.
4. `relationship-coach` prompt, reviewed knowledge, safety policy, and evaluation fixtures.
5. Tool attribution, plugin audit logs, version upgrade, rollback, and gradual rollout.
