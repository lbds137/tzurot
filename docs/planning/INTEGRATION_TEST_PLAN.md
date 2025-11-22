# Integration Test Plan - Phase 0

> **Created**: 2025-11-22
> **Updated**: 2025-11-22 (terminology clarification)
> **Status**: Planning
> **Context**: Phase 0 Task 0.7 - Inventory critical paths lacking integration tests

## Testing Terminology (Capital One Model)

1. **Unit Tests** - Isolated functions/classes, all dependencies mocked
   - Example: `personalityMentionParser.test.ts`
   - **Current**: 989 tests ✅

2. **Component Tests** - Single service with real database/Redis, external services mocked
   - Example: `AIRoutes.test.ts` (real Prisma, mocked BullMQ/AI providers)
   - **Current**: 80 tests ✅
   - **Also called**: Integration tests (our current naming)

3. **Contract Tests** - Verify service boundaries/APIs conform to agreed contracts
   - Example: Validate BullMQ job payload structure matches schema in both api-gateway and ai-worker
   - **Current**: 0 tests ❌
   - **Realistic for us**: ✅ YES - Lightweight, catches breaking changes at service boundaries
   - **Tools**: JSON Schema validation, Zod schema tests (we already use Zod!)

4. **Live Dependency Tests** - Multiple services communicating over real protocols
   - Example: bot-client → api-gateway → BullMQ → ai-worker (all running)
   - **Current**: 0 tests ❌
   - **Requires**: Sophisticated CI/CD pipeline (service orchestration, timing, cleanup)
   - **Realistic for us**: Limited (we're not a large bank!)

## Executive Summary

**Current State**:
- 989 unit tests ✅
- 80 component tests ✅
- 0 live dependency tests ❌

**Gap**: Missing **component test coverage** for some critical components. Live dependency tests are NOT realistic for Phase 0 (requires CI/CD infrastructure we don't have).

**Revised Goal**: Expand **component test coverage** for critical gaps, defer live dependency tests to future (when we have better CI/CD).

## Current Integration Test Coverage

### ✅ Well-Covered (Component Level)

| Test File | Coverage | Test Count | Notes |
|---|---|---|---|
| database.test.ts | Database connection | ~5 | Basic connectivity |
| RedisService.test.ts | Redis connection | ~10 | Connection pooling |
| PersonalityService.test.ts | Personality loading | ~20 | Full CRUD operations |
| AdminRoutes.test.ts | Admin API endpoints | ~15 | HTTP route testing |
| PgvectorMemoryAdapter.test.ts | Memory adapter | ~10 | **Doesn't create memories** (avoids polluting dev DB) |
| VoiceTranscriptCache.test.ts | Voice caching | ~10 | Caching only, not transcription |
| AIRoutes.test.ts | AI API routes | ~10 | **MOCKS BullMQ queue** (not end-to-end) |

**Total**: 80 tests

### ❌ Missing Component Test Coverage

#### Reality Check: What's Realistic for Phase 0?

**Live Dependency Tests** (multi-service orchestration):
- ❌ NOT realistic without sophisticated CI/CD
- ❌ Requires: Service startup/shutdown orchestration, timing coordination, test data cleanup across services
- 🧊 **Deferred**: Future improvement when we have better CI/CD infrastructure

**Component Tests** (single service, real DB/Redis):
- ✅ Realistic for Phase 0
- ✅ We already have infrastructure (tests/integration/setup.ts)
- ✅ Focus: Add coverage for critical components with gaps

---

#### 1. AIJobProcessor Component Test (HIGHEST PRIORITY) 🚨

**Scope**: Test ai-worker's `AIJobProcessor` class in isolation

**Test Flow**:
```
Test creates mock BullMQ job
    ↓
AIJobProcessor.process(job)
    ↓ Mock: AI provider response
    ↓ Real: Prisma DB queries (conversation history, LLM config)
    ↓ Real: PgvectorMemoryAdapter (if we can mock embeddings)
    ↓
Returns AI response
    ↓
Test verifies response structure
```

**Current Coverage**: None - AIRoutes.test.ts mocks the queue entirely

**Gap**: No component test for the actual job processing logic

**Why Critical**: This is the core AI response generation - if this breaks, everything breaks

**Realistic**: ✅ YES - Single service component test, just need to mock AI provider

---

#### 2. Job Processing (Related to #1)

**Flow**: BullMQ job → worker picks up → processes → returns result

**Current Coverage**: None - always mocked in tests

**Gap**:
- Worker actually picks up job from Redis
- Job processing completes successfully
- Result is returned to caller via delivery confirmation

**Why Critical**: Without this, we don't know if jobs actually process in integration environment

---

#### 3. Webhook Management

**Flow**: Personality mention → find/create webhook → set avatar/name → send response

**Current Coverage**: None

**Gap**:
- Webhook creation for personality
- Avatar and name customization per personality
- Webhook message delivery

**Why Critical**: Key feature differentiating personalities visually

---

#### 4. Referenced Messages

**Flow**: Discord message link → fetch message → extract content → include in AI context

**Current Coverage**: None

**Gap**:
- Discord API message fetching
- Content extraction (text, embeds, attachments)
- Context inclusion in AI prompt

**Why Critical**: Recently added feature (alpha.47), needs integration coverage

---

#### 5. Conversation History

**Flow**: Multiple messages → retrieve history → include in AI context

**Current Coverage**: None

**Gap**:
- History retrieval from database
- Ordering and limiting
- Context formatting

**Why Critical**: Core feature for conversation continuity

---

#### 6. Memory Retrieval (PARTIAL COVERAGE)

**Flow**: Message → generate embedding → vector search → format context → AI prompt

**Current Coverage**: PgvectorMemoryAdapter.test.ts tests adapter but **doesn't create memories**

**Gap**:
- Memory creation with real embeddings (requires OpenAI API key)
- Vector similarity search with real data
- Memory formatting in AI context

**Why Critical**: Long-term memory is a key feature differentiator

**Challenge**: Requires OpenAI API key for embeddings (costs $)

---

#### 7. Voice Transcription (PARTIAL COVERAGE)

**Flow**: Voice message attachment → Whisper API → transcription → include in AI context

**Current Coverage**: VoiceTranscriptCache.test.ts tests caching only

**Gap**:
- Whisper API integration (requires OpenAI API key)
- Audio file handling
- Transcription result caching

**Why Critical**: Voice is a supported feature

**Challenge**: Requires OpenAI API key (costs $)

---

#### 8. LLM Config Resolution (PARTIAL COVERAGE)

**Flow**: Message → load personality → resolve LLM config → invoke AI provider

**Current Coverage**: PersonalityService tests personality loading

**Gap**:
- LLM config resolution (user override vs global)
- AI provider invocation with config
- Response handling

**Why Critical**: Supports multiple AI providers and user preferences

---

## Prioritization for Phase 0 (REVISED)

Based on:
- **Realistic**: What can we actually achieve without sophisticated CI/CD?
- **Risk**: What's most likely to break during schema changes?
- **Value**: What gives us the best safety net for Phase 1?

### Priority 1: Must Have (Phase 0) - Contract Tests

**Why Contract Tests First**:
- ✅ Lightweight (no service orchestration needed)
- ✅ Catches breaking changes at service boundaries (critical for schema migration!)
- ✅ We already use Zod - can leverage existing schemas
- ✅ Fast to write and run

1. **BullMQ Job Contract Test** (Task 0.8) 🚨 CRITICAL
   - Verify: api-gateway creates jobs that ai-worker can consume
   - Verify: Job payload matches shared Zod schema
   - Verify: Both services agree on required fields
   - **Catches**: Breaking changes when we refactor job structure in Phase 1
   - Estimated: 0.5 session

2. **API Endpoint Contract Tests** (Task 0.9)
   - Verify: `/ai/generate` request/response schema
   - Verify: `/ai/confirmDelivery` request/response schema
   - Verify: `/ai/jobStatus` request/response schema
   - **Catches**: Breaking changes in API contracts
   - Estimated: 0.5 session

### Priority 2: Should Have (Phase 0) - Component Tests

3. **AIJobProcessor Component Test** (Task 0.10)
   - Test: AIJobProcessor.process() with mocked AI provider
   - Real: Prisma DB queries, conversation history
   - **Catches**: Regressions in job processing logic
   - Estimated: 1 session

4. **Conversation History Component Test** (Task 0.11)
   - Test: ConversationManager with real database
   - Verify: History retrieval, ordering, limits
   - Estimated: 0.5 session

### Priority 3: Nice to Have (Phase 1+)

3. **Webhook Management**
   - Requires: Discord API mocking or dev server
   - Defer to Phase 1

4. **Referenced Messages**
   - Requires: Discord API mocking
   - Defer to Phase 1

5. **Memory Retrieval** (Full)
   - Requires: OpenAI API key ($)
   - Consider: Mock embeddings or use test fixtures
   - Defer to Phase 1

6. **Voice Transcription** (Full)
   - Requires: OpenAI API key ($)
   - Consider: Mock Whisper API
   - Defer to Phase 1

7. **LLM Config Resolution**
   - Medium priority
   - Defer to Phase 1

---

## Implementation Plan

### Task 0.8: End-to-End Message Flow Integration Test

**File**: `tests/integration/MessageFlow.test.ts`

**Setup**:
- Spin up api-gateway Express server
- Spin up Redis (use existing test Redis)
- Spin up ai-worker job processor
- Mock: Discord.js client, AI provider (OpenRouter/Gemini)

**Test Cases**:
1. POST `/ai/generate` → job created in BullMQ
2. Worker picks up job from Redis
3. Worker processes job (with mocked AI response)
4. Worker sends delivery confirmation to api-gateway
5. Verify: Job status is "completed"
6. Verify: Response delivered correctly

**Estimated Time**: 1 session

---

### Task 0.9: Conversation History Integration Test

**File**: `tests/integration/ConversationHistory.test.ts`

**Setup**:
- Prisma test database
- Create test conversation history records

**Test Cases**:
1. Insert multiple messages for user + personality
2. Retrieve conversation history (verify ordering)
3. Verify limit enforcement (maxConversationHistory)
4. Verify recent messages prioritized

**Estimated Time**: 0.5 session

---

## Success Criteria (Phase 0)

- ✅ At least 2 end-to-end integration tests (Tasks 0.8, 0.9)
- ✅ Message flow test covers BullMQ job processing (unblocks schema changes)
- ✅ Tests run in CI/CD pipeline
- ✅ Tests catch regressions (verify by intentionally breaking something)

---

## Deferred to Phase 1+

- Webhook management integration test
- Referenced messages integration test
- Full memory retrieval test (with real embeddings or mocked)
- Full voice transcription test (with Whisper API or mocked)
- LLM config resolution integration test

**Rationale**: Phase 0 goal is to establish a SAFETY NET for schema changes. The two critical tests (message flow + conversation history) provide 80% of the value for 20% of the effort.

---

## Testing Strategy

### What to Mock vs What to Test

**Always Mock** (to avoid costs and external dependencies):
- ✅ AI Providers (OpenRouter, Gemini, OpenAI) - Use fixture responses
- ✅ Discord API - Use mock Discord.js client
- ✅ OpenAI Whisper API - Mock transcription responses
- ✅ OpenAI Embeddings API - Mock embedding vectors

**Always Test Real** (critical integration points):
- ✅ PostgreSQL database
- ✅ Redis connection
- ✅ BullMQ job queue
- ✅ Service-to-service HTTP communication

### Test Environment

- **Database**: Separate test database (not dev/production)
- **Redis**: Separate Redis instance or namespace
- **BullMQ**: Real queue, but in test Redis namespace
- **Costs**: $0 (everything mocked that costs money)

---

## Future: Live Dependency Tests (Phase 2+)

### Potential Architecture with Railway

**Test Environment** (Railway makes this easy):
- Create `test` environment (alongside `development` and `production`)
- Deploy all 3 services: bot-client, api-gateway, ai-worker
- Isolated Redis and PostgreSQL instances
- **Cost**: Usage-based (Pro plan $20/month) - only costs when running, can spin up/down as needed

**CI/CD Integration** (This is the hard part):
```yaml
# .github/workflows/live-dependency-tests.yml (future)
- Deploy to Railway test environment
- Wait for health checks (all services ready)
- Run live dependency tests via HTTP
- Collect test results
- Clean up test data or tear down environment
```

**Challenges** (mostly CI/CD integration, not cost):
- Railway API integration in GitHub Actions
- Service startup timing coordination
- Flaky tests from race conditions
- Test data cleanup across services
- ~~Cost per test run~~ **NOT a concern** - Railway Pro plan is usage-based ($20/month)

**Decision**: Not a Phase 0 priority (CI/CD complexity, not cost). Contract tests provide sufficient safety net for schema changes.

**Revisit**: Could be Phase 1 or 2 if we prioritize CI/CD integration. Cost is not a blocker!

---

## Open Questions

1. **Test Database**: Use separate test DB or dev DB?
   - **Recommendation**: Separate test DB (avoid pollution)

2. **OpenAI API Key**: Mock embeddings or use real API with test budget?
   - **Recommendation**: Mock for Phase 0, real API in Phase 1 with budget cap

3. **Discord API**: Mock or use dev Discord server?
   - **Recommendation**: Mock for Phase 0, consider dev server in Phase 1

4. **Railway Test Environment**: When to set up third environment?
   - **Recommendation**: Could be Phase 1 or 2 (cost is not a blocker!)
   - **Main barrier**: CI/CD integration complexity, not cost
   - **Pro plan**: Usage-based pricing - test environment only costs when running

---

## Related Documentation

- [ROADMAP.md](../../ROADMAP.md) - Phase 0 Sprint 0 Tasks
- [TESTING.md](../guides/TESTING.md) - Testing philosophy and patterns
- [ARCHITECTURE_DECISIONS.md](../architecture/ARCHITECTURE_DECISIONS.md) - Why microservices

---

**Last Updated**: 2025-11-22
