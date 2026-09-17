# LumiMate Service

LumiMate 后端服务。负责聊天 SSE、后续 AI/Agent 编排、文件与知识库、定时任务、推送，以及硬件设备接入。

## 当前能力

- NestJS + Fastify + TypeScript 服务骨架。
- 本地 PostgreSQL、Redis 与 Prisma migration。
- Redis/BullMQ 队列连接基础。
- 健康检查：`GET /v1/health`。
- SSE 聊天演示：`POST /v1/chats/:conversationId/messages`。
- 数据模型基础：用户、会话、消息、定时任务、知识库文档与分块。

当前 SSE 仅返回演示文本；尚未接入模型、鉴权、消息持久化、上传、知识库检索或真实任务执行。完整计划见 [TODO.md](./TODO.md)。

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

## AI Provider 配置

模型由每个智能体的“高级设置 → 聊天模型”保存到会话。客户端只发送模型 ID；所有密钥只保留在服务端 `.env`。

可用模型接口：`GET /v1/ai/models`。接口只返回 `AiModel.enabled=true` 的模型；角色设置页通过此接口加载候选项。停用模型时在数据库中将对应行的 `enabled` 改为 `false`，该模型会从客户端隐藏，且不能保存或继续发起聊天。

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
```

模型协议固定由服务端白名单决定：

- `deepseek-flash`（DeepSeek-V4.1-Flash）、`deepseek-v4-pro`（DeepSeek-V4.1-Pro）：DeepSeek，OpenAI Chat Completions，共用 `DEEPSEEK_API_KEY`。
- `gpt-5.6-luna`、`gpt-5.6-sol`、`gpt-6-astra`：HaloMobi，OpenAI Chat Completions。
- `claude-opus-4-7`、`claude-opus-4-8`：HaloMobi，Anthropic Messages。
- `gpt-image-2`：HaloMobi 图片生成模型，仅供后续图片生成接口使用；不出现在聊天模型列表，也不会走 Chat Completions。

不在白名单中的模型 ID 会被设置接口拒绝。未配置某个 Provider 的 Key 时，仅该 Provider 的聊天请求返回 SSE `error`，不会影响已配置模型。

`deepseek-flash` 已支持图片理解。发送消息时在 `attachments` 中提供公开 HTTP(S) 地址，或 `data:image/...;base64,...`；本次图片会与文字传给模型，历史消息仅保留文本上下文，避免旧图片失效或重复产生视觉 token 费用。LumiMate 客户端会将所选图片压缩后转为 Base64 data URL，无需公网图床。单次 API 请求上限为 `16 MiB`，客户端限制单张图片约 `11 MiB`。

```bash
curl -N -X POST http://localhost:3000/v1/chats/local/messages \
  -H 'Content-Type: application/json' \
  -d '{"content":"这张图片里有什么？","attachments":[{"url":"https://example.com/photo.jpg","mimeType":"image/jpeg"}]}'
```

新增模型时，在 `src/ai/model-catalog.ts` 登记模型 ID、协议、Provider；协议实现仍隔离在 `src/ai/providers/`，不泄漏到 `chat/`、`agent/` 模块。

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
│   ├── database/                        # Prisma 连接生命周期
│   ├── health/                          # PostgreSQL、Redis 健康检查
│   └── tasks/                           # BullMQ 队列注册
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
