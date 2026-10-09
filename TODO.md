# LumiMate Service TODO

## 0. Foundation — current

- [x] NestJS + Fastify service skeleton
- [x] Local PostgreSQL and Redis Compose stack
- [x] Prisma data model foundation
- [x] Redis/BullMQ connection foundation
- [x] Health endpoint: `GET /health`
- [x] SSE demo endpoint: `POST /v1/chats/:conversationId/messages`
- [ ] Add `.env` from `.env.example`, start local dependencies, run migration

## 1. Identity and persistent chat

- [ ] Email/OAuth login, access token and refresh token
- [ ] User, companion profile, conversation and message persistence
- [ ] Replace demo SSE output with model provider streaming
- [ ] Media upload: signed object-storage URL, MIME/size validation, virus scan
- [ ] Image input and audio transcription pipeline
- [ ] Rate limits, request IDs, audit log and error tracking

## 2. Agent tools

- [x] Create `AgentRunner` abstraction; provider implementation stays behind it
- [x] Add Provider Registry: DeepSeek and generic OpenAI-compatible Provider
- [ ] Tool schemas: `search_knowledge`, `nearby_poi`, `create_scheduled_task`, `list_scheduled_tasks`, `cancel_scheduled_task`
- [ ] Tool permission checks: user ownership, consent, allowlists and idempotency
- [ ] Persist tool call/result events as chat timeline entries
- [ ] Return SSE event types: `message.delta`, `tool.calling`, `tool.result`, `message.completed`, `error`
- [ ] Add evaluation fixtures for tool selection and safety boundaries

## 2.5 Skill Plugins（多技能架构）

- [x] 建立 `SkillPlugin`、`SkillPluginVersion`、`ConversationSkillPlugin` 数据模型；会话绑定固定版本，不能被插件更新意外改变。
- [ ] 建立服务端 Plugin Registry：当前只加载代码内审核目录；后续补管理员发布、灰度、回滚和审计签名。
- [x] Manifest 固定声明：`id`、版本、提示词片段、知识库绑定、允许工具、上下文/工具预算、风险策略、UI 元数据。
- [ ] 将有效工具集限制为“全局工具白名单 ∩ 插件声明 ∩ 用户授权 ∩ 会话策略”；当前已限制 manifest、提示词预算和写工具确认，后续将所有工具调用统一接入策略。
- [x] 在 `AgentRun`、消息元数据写入 `pluginId`、`pluginVersion`；评测记录待评测体系落地后补充。
- [x] 支持多个插件并存：按显式优先级注入受预算限制的提示词；同一工具取最高优先级技能归属。
- [ ] 首个插件：`relationship-coach`。借鉴 `goutoujunshi` 的情绪承接、事实/推测/未知分离、关系记忆同意门禁和高风险分流；知识资料另行审校、来源化和版本化。
- [x] App：插件目录、会话启用/禁用、版本说明、工具/知识范围和插件级记忆读取授权。

## 3. Location and maps

- [ ] Explicit location-consent record and expiration
- [ ] Nearby POI provider adapter; do not expose provider key to Expo client
- [ ] Reverse geocoding and coordinate precision reduction for stored history
- [ ] Show location/tool source in each AI answer

## 4. Scheduled tasks and proactive companionship

- [ ] Task CRUD, timezone and repeat-rule validation
- [ ] BullMQ delayed/repeatable jobs and idempotent execution
- [ ] Quiet hours, daily quota, opt-out and companion frequency policy
- [ ] Persist generated proactive messages before delivery
- [x] Expo Push token registration, offline delivery, ticket/receipt audit, retry and invalid-token disablement

## 5. Knowledge base

- [x] 文本/Markdown 入库、用户归属、知识库归档与文档删除级联；二进制文件上传待对象存储接入。
- [ ] PDF/DOCX/text parsing; OCR image pipeline
- [ ] 已完成文本分块、关键词检索和引用片段；待补 Embedding、pgvector 混合检索与检索评测。
- [x] 文档删除级联删除当前分块；对象存储和向量索引接入后补物理对象清理。
- [ ] Per-user/knowledge-base access control and retrieval evaluation set

## 6. Devices — later

- [ ] Device registration, credentials, ownership and status model
- [ ] MQTT broker and TLS device identity
- [ ] Command allowlists, acknowledgements, retry and audit events
- [ ] Signed OTA metadata and rollout controls
