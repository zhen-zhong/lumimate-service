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

## AI Provider 配置

聊天与 Agent 仅依赖 `AgentRunner` 和 `AiChatProvider`，不依赖 DeepSeek。当前已内置：

- `deepseek`：DeepSeek Provider。
- `openai-compatible`：任何兼容 OpenAI Chat Completions API 的模型服务。

### DeepSeek

在 [DeepSeek 开放平台](https://platform.deepseek.com/) 创建 API Key，将其仅写入服务端 `.env`：

```dotenv
AI_PROVIDER=deepseek
DEEPSEEK_API_KEY=sk-your-key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-flash
```

### 其他 OpenAI-compatible 服务

```dotenv
AI_PROVIDER=openai-compatible
AI_COMPATIBLE_API_KEY=provider-api-key
AI_COMPATIBLE_BASE_URL=https://provider.example.com/v1
AI_COMPATIBLE_MODEL=provider-model-id
```

切换只需修改 `.env` 并重启服务，无需改聊天或 Agent 代码。未配置 Key 时，接口返回 SSE `error`，不会降级为伪造 AI 回复。

### 不兼容 OpenAI API 的第三方

在 `src/ai/` 新建一个实现 `AiChatProvider` 的类，在 `AiModule` 注册 `AI_PROVIDER` 分支即可。不要把第三方 SDK、鉴权、流式协议或模型参数泄漏到 `chat/`、`agent/` 模块。

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
│   └── migrations/
├── src/
│   ├── agent/
│   ├── ai/
│   ├── chat/
│   ├── database/
│   ├── health/
│   └── tasks/
├── .env                 # 本机私有配置，Git 忽略
├── .env.example         # 可提交的环境变量模板
├── docker-compose.yml
├── README.md
├── TODO.md
├── package.json
└── tsconfig*.json
```

| 目录/文件 | 职责 |
| --- | --- |
| `src/` | 应用源码。模块之间通过 NestJS DI 连接，避免聊天、模型、数据库逻辑互相耦合。 |
| `src/main.ts` | 应用入口。启动 Fastify、全局 `/v1` 前缀、CORS 与请求 DTO 校验。 |
| `src/app.module.ts` | 根模块。组装 Config、BullMQ、数据库、AI、Agent、聊天、健康检查和任务模块。 |
| `src/ai/` | 模型 Provider 层。`AiChatProvider` 是统一接口；`AiModule` 按 `AI_PROVIDER` 选择 Provider；`OpenAiCompatibleChatProvider` 适配 DeepSeek 和其他兼容 OpenAI Chat Completions API 的服务。新增模型服务优先放这里。 |
| `src/agent/` | Agent 编排层。`AgentRunner` 负责系统提示词、上下文和后续工具调用流程，只依赖 `AiChatProvider`，不直接依赖 DeepSeek 或其他模型 SDK。 |
| `src/chat/` | App 聊天 HTTP/SSE 接口。接收用户消息，调用 `AgentRunner`，将 `message.created`、`message.delta`、`message.completed` 或 `error` 推给客户端。后续消息持久化、图片/音频引用也放这里。 |
| `src/database/` | PrismaClient 生命周期。应用启动连接 PostgreSQL，关闭时断开；业务模块通过 `PrismaService` 访问数据库。 |
| `src/health/` | `GET /v1/health`。检查 PostgreSQL 查询和 Redis `PING`，用于本地排查、容器探针和部署监控。 |
| `src/tasks/` | BullMQ 队列注册。后续定时提醒、主动陪伴、文档解析、推送发送等后台任务放这里。 |
| `prisma/` | 数据库定义与版本记录。`schema.prisma` 是数据模型唯一来源。 |
| `prisma/migrations/` | Prisma 生成的数据库变更历史。必须提交；新环境通过 migration 还原表结构。禁止手改已应用 migration。 |
| `docker-compose.yml` | 本地 PostgreSQL、Redis 容器及数据卷。当前映射到主机 `5433`、`6380`。 |
| `.env` | 本机密钥与连接配置，例如 `DEEPSEEK_API_KEY`。绝不提交。 |
| `.env.example` | `.env` 模板。只保留变量名、示例值和无敏感配置，可提交。 |
| `package.json` | Node 依赖、脚本、Node 版本要求。 |
| `package-lock.json` | 精确依赖锁定文件。必须和 `package.json` 一起提交。 |
| `nest-cli.json` | NestJS CLI 源码目录配置。 |
| `tsconfig.json` | TypeScript 编译与装饰器配置。 |
| `tsconfig.build.json` | 生产构建排除规则，例如测试文件。 |
| `TODO.md` | 功能分期、未完成事项与架构边界。 |
| `dist/` | `npm run build` 生成的编译产物，Git 忽略。 |
| `node_modules/` | npm 安装的依赖，Git 忽略。 |

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
