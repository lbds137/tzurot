# Discord Rules

## 3-Second Rule (CRITICAL)

Discord requires acknowledgment within 3 seconds. Any async work — AI calls,
gateway fetches, Redis lookups, Prisma queries — must happen **after** the ack,
never before. The 3-second budget is indivisible: a sub-millisecond Redis
lookup today is a multi-second lookup under load, and the window doesn't
distinguish between types of async work.

**Enforced at lint time** by the `@tzurot/component-handler-ack-first` ESLint
rule (`'error'`): a bare interaction ack (`deferUpdate`/`deferReply`/`reply`/
`update`/`showModal`) must not follow awaited async work in a component/modal
handler. Either ack first, or — when the data must be fetched before the ack
(e.g. a modal prefilled from a row) — route the ack through a
`*WithTimeoutCatch` wrapper so a blown budget degrades to a `followUp`.

### Slash commands: defer first, then process

`await interaction.deferReply()` IMMEDIATELY, then do the async work, then `editReply`.

### Component interactions (buttons, select menus): defer first, then look up session

The same rule applies to `handleButton` / `handleSelectMenu` — the common
antipattern is awaiting the session lookup **before** `deferUpdate`. **The
first `await` in a component handler must be on `interaction.deferUpdate()`**
(or `deferReply` for new ephemeral replies). Branch on session state **after**
the ack, and use `followUp` for the error path (`reply()` throws once acked).

**Exception**: synchronous guards that don't `await` (customId prefix
validation, parsing — e.g. `isMemoryBrowsePagination` in `memory/browse.ts`)
can run before the ack to decide whether this handler claims the interaction.
A Redis/DB lookup of any kind _must_ run after.

**Nested routers (handleButton → detail handlers)**: when a top-level
router (e.g., `interactionHandlers.handleButton`) has to do async work
before dispatching (a session lookup to pick the right downstream handler),
the router itself must ack first. Downstream handlers that previously
self-deferred must then guard against double-ack:

`if (!interaction.deferred && !interaction.replied) await interaction.deferUpdate();`
— this keeps downstream handlers callable standalone (tests, direct dispatch).
Don't unconditionally remove the downstream defer; that couples the handler to
one caller contract.

References: `commands/character/browse.ts` `handleBrowsePagination` (ack
first); `memory/interactionHandlers.ts` `handleButton` (the router that acks
first) with `memory/detailActionRouter.ts` `case 'back'` (the downstream guard
in its simplest form); `memory/detail.ts` `handleDeleteConfirm` (a leaf
handler also called standalone from tests).

## Deterministic UUIDs

Never use `uuid.v4()` - use generators from common-types for deterministic IDs.

## Slash Command Standards

### Subcommand Names

| Subcommand | Purpose            | Notes                              |
| ---------- | ------------------ | ---------------------------------- |
| `browse`   | Paginated list     | **Preferred** - has select menu    |
| `list`     | Simple list        | Legacy - use `browse` for new cmds |
| `view`     | Single item detail |                                    |
| `create`   | Create new item    |                                    |
| `edit`     | Modify item        | Opens dashboard                    |
| `delete`   | Remove item        | Must confirm                       |

### Response Types

Ephemeral (`flags: MessageFlags.Ephemeral`) for settings, errors, dashboards, and sensitive data; public for displays others might want to see.

### Button Emoji Pattern

**ALWAYS use `.setEmoji()` separately from `.setLabel()`** — `.setLabel('Back').setEmoji('◀️')`, never `.setLabel('◀️ Back')` (skinny buttons).

### Standard Button Order

1. Primary actions (Edit, Lock/Unlock)
2. View actions
3. Navigation (Back to List)
4. Destructive (Delete - always last, `ButtonStyle.Danger`)

## Component Interaction Routing (CRITICAL)

Commands with interactive components (buttons, select menus) **MUST**:

1. Export `handleButton` and/or `handleSelectMenu` from `defineCommand()`
2. Use `command::action::id` custom ID format (`::` delimiter — never `-`)
3. Route through CommandHandler — **NEVER** use `awaitMessageComponent` or
   `createMessageComponentCollector` as the primary interaction handler

**Why:** inline collectors don't survive restarts, don't work in multi-replica
deployments, and race with CommandHandler's global interaction handler.

**Encode state in custom IDs or embed fields** instead of closures:
`shapes::import-confirm::full` encodes the import type; the slug is stored in
the embed footer (`slug:my-shape`) to stay within Discord's 100-char custom ID limit.

**Exception:** Collectors may be used INSIDE exported handler functions as a
secondary mechanism (e.g., memory batch delete timeout), but the initial routing
MUST go through CommandHandler.

## Shared Utilities

**ALWAYS check for existing utilities before implementing:**

| Pattern                  | Shared Utility                  | Location                                        |
| ------------------------ | ------------------------------- | ----------------------------------------------- |
| Browse pagination        | `createBrowseCustomIdHelpers`   | `utils/browse/customIdFactory.ts`               |
| Browse buttons           | `buildBrowseButtons`            | `utils/browse/buttonBuilder.ts`                 |
| Browse truncation        | `truncateForSelect`             | `utils/browse/truncation.ts`                    |
| Browse page-load failure | `followUpBrowsePageFailure`     | `utils/browse/pageLoadFailure.ts`               |
| Dashboard builder        | `buildDashboardEmbed`           | `utils/dashboard/DashboardBuilder.ts`           |
| Dashboard modals         | `buildSectionModal`             | `utils/dashboard/ModalFactory.ts`               |
| Dashboard sessions       | `initSessionManager`            | `utils/dashboard/SessionManager.ts`             |
| Dashboard messages       | `DASHBOARD_MESSAGES`            | `utils/dashboard/messages.ts`                   |
| Dashboard close          | `handleDashboardClose`          | `utils/dashboard/closeHandler.ts`               |
| Dashboard refresh        | `createRefreshHandler`          | `utils/dashboard/refreshHandler.ts`             |
| Dashboard delete         | `buildDeleteConfirmation`       | `utils/dashboard/deleteConfirmation.ts`         |
| Dashboard perms          | `checkEditPermission`           | `utils/dashboard/permissionChecks.ts`           |
| Session helpers          | `fetchOrCreateSession`          | `utils/dashboard/sessionHelpers.ts`             |
| Dashboard select menu    | `handleDashboardSectionSelect`  | `utils/dashboard/genericSelectMenuHandler.ts`   |
| Dashboard modal merge    | `extractAndMergeSectionValues`  | `utils/dashboard/modalHelpers.ts`               |
| Interaction error reply  | `replyError`                    | `utils/dashboard/replyError.ts`                 |
| Personality autocomp     | `handlePersonalityAutocomplete` | `utils/autocomplete/`                           |
| Persona autocomplete     | `handlePersonaAutocomplete`     | `utils/autocomplete/`                           |
| List sorting             | `createListComparator`          | `utils/listSorting.ts`                          |
| Round-trip contract      | `DASHBOARDS` registry           | `utils/dashboard/updateSchemaRoundTrip.test.ts` |

**Never reimplement these patterns locally.**

**A new fetch-edit-PUT dashboard MUST add itself to the `DASHBOARDS` registry.**
That guard runs a null-bearing fetched object through the dashboard's real payload
builder and asserts the result validates against the gateway's update schema — it
catches the class where a dashboard PUTs back a field it fetched as `null` against
an update schema declaring it `.optional()` (which accepts `undefined` but rejects
`null`), 400ing every save. Registration can't be auto-discovered, so an unregistered
dashboard is simply unguarded; this table is where that requirement is visible.

## Autocomplete Formatting

Build every choice with `formatAutocompleteOption({ name, value, scopeBadge, statusBadges })` (`@tzurot/common-types/utils/autocompleteFormat`), using `AUTOCOMPLETE_BADGES` (`GLOBAL`/`OWNED` scope, `DEFAULT` status) — e.g. `"🌐⭐ Global Default · claude-sonnet-4"`.

## BullMQ Job Patterns

### Retryable vs Non-Retryable

**Retryable:** Network timeouts, rate limits (429), server errors (5xx)
**Non-retryable:** Validation errors (400), not found (404), auth (401)

### Spend-Idempotent Retries (money/budget/usage side effects)

A retried or requeued job re-executes its handler. Any job that bills a model
call, consumes a budget counter, or writes a usage row must stay correct
across that re-execution:

- **Partial completion shrinks the retry payload** — completed sub-units must
  not re-bill on every retry cycle (reference: fact-extraction's busy path
  carries `remainingMemoryIds` and `job.updateData` shrinks `sourceMemoryIds`).
- **Zero-spend failures are counter-neutral** — a rate-limit/busy failure that
  spent no tokens must not consume budget (consume-then-refund, and any
  exemption flag must gate consume and refund SYMMETRICALLY).
- **Usage rows write only past the point of no return** — after the response
  is in hand (parse failures still spent tokens; busy throws did not), never
  before a retryable throw.

### Queue Configuration

Queues set `defaultJobOptions` — bounded `attempts` with exponential `backoff`, and bounded `removeOnComplete`/`removeOnFail` history (live values: `services/api-gateway/src/queue.ts`).

### Timer Patterns

`setTimeout` is fine for request timeouts and one-time delays (an `AbortController` abort). A persistent `setInterval` is a scaling blocker — use a BullMQ repeatable job (`queue.add(name, {}, { repeat: { every } })`) instead.

## DMs silent: diagnosis order

1. **Interactions work, messages don't** = Discord delivers interactions (HTTPS, no intents) but not MESSAGE_CREATE (gateway: intents + install scope). That's Discord-side, not our code.
2. **Guild fine, DMs not** = the message-content intent is on; narrow to DM state.
3. **Root cause: post-reconnect DM subscription loss.** Discord doesn't re-subscribe a bot to existing DM channels on gateway reconnect (guilds re-subscribe via GUILD_CREATE), so after every deploy or restart plain DMs drop until an interaction re-opens the channel. "Deauth + reauth fixes it" only worked because it re-opened the channel. The fix is shipped: `services/StartupDMPrewarmer.ts` + `services/DMCacheWarmer.ts` in bot-client. If it recurs, read the prewarmer's logs first; it may have missed the user or failed.
4. Only then check Dev Portal settings (User Install contexts/scopes, MESSAGE CONTENT intent, Authorized Apps, Message Requests).

Don't pull Railway logs filtered for DM activity when no events reach the bot; absence of our logs is consistent with gateway non-delivery. The log shape when it IS this bug: `Ignoring system message` with `messageType=20` (one slash-command messageCreate, zero Default/Reply types since the last interaction). DM entry points: `DMSessionProcessor.ts`, `nsfwVerification.ts`.

## Observability

### Correlation IDs

bot-client generates a `requestId` (`randomUUID()`) and sends it as the `X-Request-ID` header; every service includes it in logs (`logger.info({ requestId, jobId }, 'Processing')`). When a whole call path should carry the id — especially when it hands a `logger` to a helper like `withRetry` that emits its own lines — bind once at the entry point (`const log = logger.child({ requestId })`) and thread the bound logger instead of adding `requestId` to every call site. Reference: `processAttachmentsParallel` in ai-worker's `AttachmentProcessor.ts`.

### Structured Logging

Structured data first, static message second (`logger.info({ personalityId, model }, 'Loaded personality')`) — never string interpolation, which loses structure.
