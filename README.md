# LumiMate Service

LumiMate 后端服务。负责聊天 SSE、后续 AI/Agent 编排、文件与知识库、定时任务、推送，以及硬件设备接入。

## 当前能力

- NestJS + Fastify + TypeScript 服务骨架。
- 本地 PostgreSQL、Redis 与 Prisma migration。
- Redis/BullMQ 队列连接基础。
- 健康检查：`GET /v1/health`。
- SSE 聊天、消息持久化、上下文窗口、可切换聊天/生图模型。
- 图片理解、聊天内图片生成和编辑。
- P0 陪伴记忆：候选提取、人工确认、编辑、删除、按相关性召回。
- P0 关系资料：称呼、关系摘要、沟通偏好。
- P0 意图任务：显式创建、确认、取消、BullMQ 到时执行；主动陪伴默认关闭，受静默时间、频率、每日上限约束。
- Expo Push：真机 token 登记、到期提醒/主动陪伴投递、BullMQ 重试、ticket/receipt 审计、失效设备自动停用。
- 知识库基础：文本/Markdown 入库、自动分块、用户隔离关键词检索、引用片段和级联删除。
- 数据模型：用户、会话、消息、模型目录、记忆、关系资料、意图任务、知识库、文档与分块。

当前未实现：账户鉴权、多用户生产隔离、语义向量召回、文件上传/OCR、LLM 结构化记忆抽取、硬件控制。完整路线见 [TODO.md](./TODO.md)。

多技能能力采用受控的服务端 Skill Plugin，而非加载插件脚本或直接执行第三方 `SKILL.md`。设计、权限边界和首个 `relationship-coach` 规划见 [docs/skill-plugin-architecture.md](./docs/skill-plugin-architecture.md)。

## 技术栈

```text
Node.js 22 + TypeScript
NestJS + Fastify
PostgreSQL + Prisma
Redis + BullMQ
SSE
Docker Compose
```

## 前置条件

- Node.js `>= 22`
- Docker Desktop 或 Colima
- npm

## 本地启动

```bash
cd /Users/Zhuanz/Documents/lumimate-service
cp .env.example .env
npm install
npm run infra:up
npm run db:generate
npm run db:migrate -- --name init
npm run start:dev
```

服务默认监听 `http://localhost:3000`。

## API 文档

启动服务后访问 Swagger UI：`http://localhost:3000/docs`；OpenAPI JSON：`http://localhost:3000/docs-json`。接口路径统一以 `/v1` 开头。当前文档包含健康检查、会话设置与流式聊天接口；聊天消息的响应是 `text/event-stream`，建议使用 `curl -N` 或支持 SSE 的客户端查看完整事件流。

### 陪伴记忆与任务 API

所有接口按会话隔离；当前 MVP 固定使用本地用户 `local-user`，接入鉴权前不能作为多用户生产接口。

```text
GET    /v1/chats/:conversationId/memories
POST   /v1/chats/:conversationId/memories/:memoryId/confirm
PUT    /v1/chats/:conversationId/memories/:memoryId
DELETE /v1/chats/:conversationId/memories/:memoryId

GET    /v1/chats/:conversationId/relationship
PUT    /v1/chats/:conversationId/relationship
GET    /v1/chats/:conversationId/proactive-policy
PUT    /v1/chats/:conversationId/proactive-policy

GET    /v1/chats/:conversationId/intents
POST   /v1/chats/:conversationId/intents
POST   /v1/chats/:conversationId/intents/:intentId/confirm
DELETE /v1/chats/:conversationId/intents/:intentId
```

创建任务不会立即执行，先返回 `AWAITING_CONFIRMATION`；必须调用 `confirm` 后才会入队。主动陪伴策略默认 `enabled=false`。任务到时会写入助手消息，并向已启用的 Expo Push 设备投递通知。

聊天里可先试：`今天 18:30 提醒我取快递`、`明天 9 点提醒我开会`、`后天上午 9 点提醒我体检`、`3天后 15:00 通知我提交报告`、`2026-10-10 18:30 提醒我取快递`。未写日期时按今天处理。服务会发出 SSE `agent.run.proposed`，客户端展示确认框；取消会删除候选工具调用。时间必须晚于当前时刻。

### Agent Tool Run

工具调用与业务任务分开保存。当前已开放 `task.create`：聊天检测到明确时间的提醒时，只创建 `AgentRun(AWAITING_CONFIRMATION)`，并发送 SSE `agent.run.proposed`；客户端确认后调用：

```text
POST   /v1/chats/:conversationId/agent-runs/:runId/confirm
DELETE /v1/chats/:conversationId/agent-runs/:runId
GET    /v1/chats/:conversationId/agent-runs
```

确认接口才会创建 `AgentIntent(SCHEDULED)` 并写入 BullMQ。每个 `AgentRun` 保存工具名、权限等级、输入、输出、执行状态和错误，后续地图、知识库、设备工具复用同一确认与审计模型。`READ` 工具可在后续直接执行；`WRITE`、`SENSITIVE` 工具必须保留确认步骤。

### 知识库基础 API

当前仅接收文本与 Markdown JSON 入库。服务端按用户归属隔离，立即按自然段/句子分块并提供关键词检索；检索结果返回 `documentId`、文件名、chunk 序号和引用片段。尚未接收 PDF、Word、图片或任意二进制文件。

```text
GET    /v1/chats/:conversationId/knowledge/bases
GET    /v1/chats/:conversationId/knowledge/documents
POST   /v1/chats/:conversationId/knowledge/documents/text
GET    /v1/chats/:conversationId/knowledge/search?query=...
DELETE /v1/chats/:conversationId/knowledge/documents/:documentId
```

```bash
curl -X POST http://localhost:3000/v1/chats/local/knowledge/documents/text \
  -H 'Content-Type: application/json' \
  -d '{"filename":"偏好.md","mimeType":"text/markdown","content":"我喜欢安静的咖啡馆。"}'
```

首次拉取此版本后，先应用迁移：

```bash
npm run db:generate
npx prisma migrate deploy
```

### Expo Push

客户端在“提醒与陪伴 → 推送提醒”开启后，才请求系统通知权限并登记 `ExpoPushToken`。服务端不保存 APNs/FCM 私钥；通过 Expo Push Service 投递。到期提醒和允许的主动陪伴任务会创建 `PushDelivery`，发送任务失败最多重试 3 次，15 分钟后查询 receipt；`DeviceNotRegistered` 会自动停用设备。

```text
GET    /v1/chats/:conversationId/push-devices
POST   /v1/chats/:conversationId/push-devices
DELETE /v1/chats/:conversationId/push-devices/:expoPushToken
```

`EXPO_PUSH_ACCESS_TOKEN` 仅在 Expo Enhanced Push Security 已开启时配置。iOS 和 Android 仍需在 EAS Credentials 中配置各自 APNs/FCM 推送凭据，并重新构建原生包后测试。

## 媒体存储（腾讯云 COS）

生产环境通过 COS SDK 直接存取图片、视频和音频；数据库仅保存经 API 鉴权的 `/v1/media/...` 地址。客户端不能根据 COS 对象地址绕过会话归属校验。

```dotenv
COS_SECRET_ID=你的CAM编程访问SecretId
COS_SECRET_KEY=你的CAM编程访问SecretKey
COS_BUCKET=lumimate-1310885489
COS_REGION=ap-beijing
COS_PREFIX=lumimate-media
```

`COS_PREFIX` 下固定分为 `images/`、`videos/`、`audio/`。大视频先在容器 `/tmp/lumimate-media` 接收分片，再用 COS Multipart 完成最终对象上传；视频处理完成后临时文件会删除。CAM 子账号只需该前缀的对象读写、删除和 Multipart 权限，不要授予控制台登录或全量 COS 权限。

## AI Provider 配置

模型由每个智能体的“高级设置 → 聊天模型”保存到会话。客户端只发送模型 ID；所有密钥只保留在服务端 `.env`。

可用模型接口：`GET /v1/ai/models?capability=chat` 或 `GET /v1/ai/models?capability=image-generation`。接口只返回 `AiModel.enabled=true` 的模型；角色设置页通过聊天能力接口加载候选项。停用模型时在数据库中将对应行的 `enabled` 改为 `false`，该模型会从对应客户端列表隐藏。

```dotenv
DEEPSEEK_API_KEY=sk-your-key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-flash

HALOMOBI_BASE_URL=https://token.halomobi.com/v1
HALOMOBI_GPT_IMAGE_2_API_KEY=key-for-gpt-image-2
HALOMOBI_CLAUDE_OPUS_4_7_API_KEY=key-for-claude-opus-4-7
HALOMOBI_CLAUDE_OPUS_4_8_API_KEY=key-for-claude-opus-4-8
HALOMOBI_GPT_5_6_LUNA_API_KEY=key-for-gpt-5.6-luna
HALOMOBI_GPT_5_6_SOL_API_KEY=key-for-gpt-5.6-sol
HALOMOBI_GPT_6_ASTRA_API_KEY=key-for-gpt-6-astra
TEAMOROUTER_BASE_URL=https://api.teamorouter.com
TEAMOROUTER_API_KEY=key-for-teamorouter-image-models
```

模型协议固定由服务端白名单决定：

- `deepseek-flash`（DeepSeek-V4.1-Flash）、`deepseek-v4-pro`（DeepSeek-V4.1-Pro）：DeepSeek，OpenAI Chat Completions，共用 `DEEPSEEK_API_KEY`。
- `gpt-5.6-luna`、`gpt-5.6-sol`、`gpt-6-astra`：HaloMobi，OpenAI Chat Completions。
- `claude-opus-4-7`、`claude-opus-4-8`：HaloMobi，Anthropic Messages。
- `gpt-image-2.5-flare`、`gpt-image-2.5-sunburst`、`gpt-image-2`：TeamoRouter OpenAI Images API，走 `POST /v1/images/generations`。
- `gemini-3.1-flash-image`：TeamoRouter Gemini 原生 API，走 `POST /v1beta/models/{model}:generateContent`。

不在白名单中的模型 ID 会被设置接口拒绝。未配置某个 Provider 的 Key 时，仅该 Provider 的聊天请求返回 SSE `error`，不会影响已配置模型。

`deepseek-flash` 已支持图片理解。发送消息时在 `attachments` 中提供公开 HTTP(S) 地址，或 `data:image/...;base64,...`；本次图片会与文字传给模型，历史消息仅保留文本上下文，避免旧图片失效或重复产生视觉 token 费用。LumiMate 客户端会将所选图片压缩后转为 Base64 data URL，无需公网图床。单次 API 请求上限为 `16 MiB`，客户端限制单张图片约 `11 MiB`。

```bash
curl -N -X POST http://localhost:3000/v1/chats/local/messages \
  -H 'Content-Type: application/json' \
  -d '{"content":"这张图片里有什么？","attachments":[{"url":"https://example.com/photo.jpg","mimeType":"image/jpeg"}]}'
```

新增模型时，在 `src/ai/model-catalog.ts` 登记模型 ID、协议、Provider；协议实现仍隔离在 `src/ai/providers/`，不泄漏到 `chat/`、`agent/` 模块。

### 图片生成

`POST /v1/ai/images/generations` 根据模型协议自动路由，并统一返回 Base64 data URL。图片生成不走聊天接口，也不使用聊天模型 Key。

`POST /v1/ai/images/edits` 编辑图片，输入原图使用 JPEG、PNG 或 WebP Base64 data URL。GPT Image 自动转 multipart：支持 `mask`、`background`、`inputFidelity`、`outputCompression` 等参数；Gemini 自动转为 `inlineData`，使用 `aspectRatio`、`imageSize` 控制输出。

```bash
curl -X POST http://localhost:3000/v1/ai/images/generations \
  -H 'Content-Type: application/json' \
  -d '{"modelId":"gpt-image-2.5-flare","prompt":"一只在键盘上打字的橘猫，插画风格","size":"1024x1024","quality":"high"}'
```

Gemini 可使用 `aspectRatio`（如 `16:9`）和 `imageSize`（`1K`、`2K`、`4K`）。生图请求最长等待 300 秒；API Key 只应配置在服务端 `TEAMOROUTER_API_KEY`。

如服务器无法直连 TeamoRouter，可设置 `TEAMOROUTER_PROXY_URL`，例如 macOS 本机代理为 `http://127.0.0.1:7897`。图片请求会单独走该代理，聊天和数据库连接不受影响。

### 聊天图片 Tool Agent

聊天接口内置 `image.generate` 与 `image.edit` 两个 Agent 工具。用户发送“生成一张夜晚北京胡同的电影海报”等明确生图请求时，服务端会跳过聊天模型并调用 `image.generate`；用户发送图片后说“把背景改成日落海滩”，或说“把上一张图改成日落海滩”时，服务端会调用 `image.edit`。默认使用 `gpt-image-2.5-flare`。

每个会话设置独立保存 `modelId`（聊天模型）与 `imageModelId`（图片创作模型）。客户端在“陪伴设定 → 图片创作”选择图片模型；保存后，下一次生图或编辑图片立即使用新模型。

工具结果以 `image.generated` SSE 事件返回，并作为助手消息附件持久化；客户端刷新后仍能显示，且可继续作为“上一张图”的编辑来源。普通对话不会调用图片工具。

## 本地依赖端口

| 服务 | 主机端口 | 容器端口 | 说明 |
| --- | ---: | ---: | --- |
| PostgreSQL | `5433` | `5432` | 本机 `5432` 已被 SSH 隧道占用 |
| Redis | `6380` | `6379` | 本机 `6379` 已被 SSH 隧道占用 |
| API | `3000` | - | NestJS 服务 |

连接配置位于 `.env`：

```dotenv
DATABASE_URL=postgresql://lumimate:lumimate@localhost:5433/lumimate?schema=public
REDIS_URL=redis://localhost:6380
```

停止本地依赖：

```bash
npm run infra:down
```

## 验证

健康检查：

```bash
curl http://localhost:3000/v1/health
```

预期结果：

```json
{"ok":true,"database":true,"redis":true}
```

测试 SSE 聊天：

```bash
curl -N -X POST http://localhost:3000/v1/chats/local/messages \\
  -H 'Content-Type: application/json' \\
  -d '{"content":"你好"}'
```

事件顺序：

```text
message.created
message.delta
message.completed
```

## 常用命令

```bash
npm run start:dev  # 开发模式
npm run build      # 编译
npm run typecheck  # TypeScript 检查
npm run db:studio  # Prisma Studio
npm run infra:up   # 启动 PostgreSQL、Redis
npm run infra:down # 停止 PostgreSQL、Redis
```

## 目录与职责

```text
lumimate-service/
├── prisma/
│   ├── schema.prisma                     # Prisma 数据模型
│   └── migrations/                      # 数据库迁移历史
├── src/
│   ├── main.ts                          # Fastify 入口、校验和 Swagger
│   ├── app.module.ts                    # 根模块
│   ├── agent/
│   │   ├── agent.module.ts
│   │   └── agent-runner.service.ts      # 提示词与上下文编排
│   ├── ai/
│   │   ├── ai.module.ts                 # 模型服务选择与注入
│   │   ├── interfaces/
│   │   │   └── ai-chat-provider.ts      # 模型调用契约
│   │   └── providers/
│   │       └── openai-compatible-chat.provider.ts
│   ├── chat/
│   │   ├── chat.module.ts
│   │   ├── chat.controller.ts           # 会话设置和 SSE 接口
│   │   ├── chat.service.ts              # 消息持久化与流式聊天
│   │   └── dto/                         # 请求参数及校验
│   ├── memory/                           # 记忆候选、关系资料、主动陪伴策略与提取队列
│   ├── knowledge/                         # 知识库、文本分块、关键词检索与引用
│   ├── database/                        # Prisma 连接生命周期
│   ├── health/                          # PostgreSQL、Redis 健康检查
│   └── tasks/                           # 意图任务 API、BullMQ 排程与执行器
├── .env.example                         # 环境变量模板
├── docker-compose.yml                   # 本地 PostgreSQL、Redis
├── package.json
└── README.md
```

各 HTTP 接口位于对应模块的 controller 中，请求参数位于 `chat/dto/`；数据库模型统一定义于 `prisma/schema.prisma`，不在业务目录重复定义。当前没有自定义中间件，因此未建立空的 middleware 目录。`.env`、`dist/` 和 `node_modules/` 均不提交到 Git。

## 后续 Agent 设计

模型只可请求工具调用；服务端完成身份、权限、参数、频率和幂等校验后才执行。

```text
search_knowledge
nearby_poi
create_scheduled_task
list_scheduled_tasks
cancel_scheduled_task
get_device_state
control_device
```

模型 Provider API Key、地图 Provider Key、对象存储密钥只能放服务端环境变量，不能放入 Expo App。

## 向量检索说明

当前本地 Compose 使用 `postgres:15-alpine`，便于立即启动。知识库接入 embedding/向量检索时，切换为 `pgvector/pgvector` 镜像并启用 `vector` 扩展。
