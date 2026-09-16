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
- [ ] Expo Push token registration and offline push delivery

## 5. Knowledge base

- [ ] File upload and ownership model
- [ ] PDF/DOCX/text parsing; OCR image pipeline
- [ ] Chunking, embedding, pgvector retrieval and source citations
- [ ] Document deletion cascades: source object, chunks, embeddings and indexes
- [ ] Per-user/knowledge-base access control and retrieval evaluation set

## 6. Devices — later

- [ ] Device registration, credentials, ownership and status model
- [ ] MQTT broker and TLS device identity
- [ ] Command allowlists, acknowledgements, retry and audit events
- [ ] Signed OTA metadata and rollout controls
