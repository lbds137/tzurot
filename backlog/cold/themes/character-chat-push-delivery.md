### Theme: `/character chat` — push-based result delivery + DM support (PersonalityChatManager extract)

_Focus: merge two related refactors into one epic. (1) `/character chat` polls for job results with a 2-min cap, orphaning long-running free-model jobs; (2) `/character chat` hard-errors in DMs because its render path is webhook-only. Both want to extract logic so slash-command and message-handler entry points share the same infrastructure._

**Sequencing**: Do BEFORE TTS-epic PR 3 continuation. The orphan-job class is an active production bug affecting free-model users only — paid-model users are unaffected because they finish under the 2-min cap. User chose structural fix over stop-gap timeout bump 2026-05-07. Production evidence: see `backlog/now.md` (Production Issues).

#### The polling-vs-push asymmetry

`/character chat` polls `pollJobUntilComplete` at `chat.ts:100` with a 2-min cap from `TIMEOUTS.JOB_BASE`. `@personality` mentions use the push-based path: ai-worker → Redis stream → `ResultsListener` → `MessageHandler.handleJobResult` → context lookup via `JobTracker.getContext` → webhook delivery. Both paths deliver via webhook ultimately. The polling cap is a self-imposed limit far tighter than what Discord allows (interaction tokens last 15 min, and slash delivery already uses webhooks rather than the interaction token).

The polling design was ergonomic (synchronous-style code, simpler test mocks), not a Discord constraint. The 2-min cap was generous when set; reasoning models and free-tier OpenRouter latency made it inadequate.

#### DM gap (original theme scope, retained)

Typing `/character chat personality:Foo` in a DM produces "This command can only be used in text channels or threads." Regular `@CharacterName hello` works fine via `DMSessionProcessor` + `PersonalityMessageHandler`. Council rejected the DRY shortcut of synthesizing a fake `Message` from `Interaction` — different Discord APIs, footgun.

#### Fix shape (multi-PR epic)

**Phase A — Push-based result delivery for `/character chat`** (closes the production bug)

1. Generalize `JobTracker.PendingJobContext` to a discriminated union: `MessageJobContext` (existing shape, behavior unchanged) and `SlashJobContext` (new — `{ channel, personality, personaId, characterSlug, isWeighInMode, userMessageTime, guildId, requestId }`).
2. Extend `MessageHandler.handleJobResult` to dispatch on context kind; slash branch does what `pollAndSendResponse`'s post-result branch currently does (webhook delivery via `sendCharacterResponse`, error fallback with `buildErrorContent`, diagnostic-response-id update, conversation persistence).
3. Rewire `chat.ts`: replace `pollAndSendResponse` with `JobTracker.trackJob(jobId, channel, slashContext)` + early return.
4. Delete `pollJobUntilComplete` from `GatewayClient.ts` (sole caller is `chat.ts`; tests are mocks).
5. After interaction defer, `interaction.editReply` to a placeholder ("Working on it…") so the "thinking…" state doesn't sit forever. Optionally delete on result arrival.

**Phase B — Protocol-agnostic PersonalityChatManager extract** (closes the DM gap, council-blessed Option D)

1. Extract domain logic from `PersonalityMessageHandler.handleMessage` into `services/character/PersonalityChatManager.ts`.
2. Manager accepts `ChatGenerationRequest { userId, channelId, isNsfwChannel, personalityId, userPrompt, authorDisplayName }`, returns response payload.
3. Each entry point parses Discord objects, calls the manager, delivers in native protocol (plain reply for messages/DMs; webhook for guild slash; `interaction.followUp` for DM slash).
4. Belt-and-suspenders: if DM branch ever hits unsupported state, reply with "In DMs you can also just type @CharacterName hello — no slash command needed."

Phases can run independently or in either order; doing them together saves a round-trip on `chat.ts` rewrites.

#### Tests

- `chat.test.ts` (~1000 lines) is the bulk of the work — polling mocks become `JobTracker.trackJob` + slash-branch handler mocks.
- Integration test: long-running mock job → result lands via listener → orphan-sweep releases on genuine hang.

#### Risks

- Phase B touches a hot path shared by multiple processors — needs integration coverage across `DMSessionProcessor`, `BotMentionProcessor`, and slash command before landing.
- Diagnostic-response-id update is currently fire-and-forget after polling — needs to also be fire-and-forget from the new handler, but the call site shifts.
- Conversation persistence uses `userMessageTime` from the original interaction context — must be captured into `SlashJobContext` before the handler returns.

**Estimated scope**: 2–3 days focused.

**Start**: `services/bot-client/src/commands/character/chat.ts:100` (poll site); `services/bot-client/src/utils/GatewayClient.ts:250` (`pollJobUntilComplete` to delete); `services/bot-client/src/services/JobTracker.ts:44` (`PendingJobContext` to generalize); `services/bot-client/src/handlers/MessageHandler.ts:91` (`handleJobResult` to add slash dispatch); `services/bot-client/src/services/ResultsListener.ts:80` (subscription contract reference); `services/bot-client/src/services/PersonalityMessageHandler.ts` (Phase B source); `services/bot-client/src/processors/DMSessionProcessor.ts` (Phase B second caller). Council consultation 2026-04-20 (Gemini 3.1 Pro Preview) for Phase B.

Surfaced 2026-05-07 (production bug merged into prior PersonalityChatManager extract theme).
