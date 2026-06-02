## 📥 Inbox

_New items go here. Triage to appropriate section weekly._

### `[FIX]` Convert persona-create unique-constraint collision to a 409

Both `handleCreatePersona` in `crud.ts` and `handleCreatePersonaOverride` in `override.ts` derive a deterministic UUID via `generatePersonaUuid(name, user.id)`. If a user already owns a persona with the same name, `persona.create` throws Prisma `P2002` which `asyncHandler` converts to a generic 500 — the bot-client surfaces "❌ Failed to create persona" with no indication that the actual cause is a name collision.

**Fix shape**: catch `Prisma.PrismaClientKnownRequestError` with `code === 'P2002'` in both handlers, map to a 409 conflict response. Bot-client side: update the create flow to surface the 409 with a helpful message ("Pick a different name or edit the existing one with /persona edit").

Surfaced 2026-05-28 by PR #1108 round-2 claude-bot review. Promoted from deferred 2026-05-29 (was parked behind "user complains" — but this is a clear, low-risk fix).

### `[FIX]` Scope-change in deny edit silently drops old entry on partial failure

`services/bot-client/src/commands/deny/detailEdit.ts` handles scope changes by upserting the new entry (line ~155) THEN removing the old one (line ~177). If the new-scope upsert succeeds but the old-scope `removeDenylistEntry` fails (transient gateway error, race, etc.), the user sees a success message but BOTH entries persist — duplicate denials for the same entity. Pre-existing behavior preserved through the PR-2f typed-client migration.

**Fix shape**: check `removeDenylistEntry` result; if `!ok`, either (a) surface a partial-success warning ("New entry created, but failed to remove old entry — use /deny browse to verify") or (b) attempt to roll back the new-scope upsert. Option (a) is honest and small; (b) introduces a third API call that itself can fail.

Surfaced 2026-05-28 by PR #1109 round-3 claude-bot review. Promoted from deferred 2026-05-29.

### `[FIX]` Distinguish "empty history" from "fetch failed" in `/shapes status`

`services/bot-client/src/commands/shapes/status.ts:50-79` displays "No imports yet" / "No exports yet" whenever the import/export job-history fetch returns falsy data — including when `result.ok` is `false` (gateway down, auth dropped, 5xx). A user with 10 past imports who hits a transient 503 sees "No imports yet" and might think their history vanished.

**Fix shape**: branch on `!result.ok` before the empty-list branch; emit `logger.warn({ status, error })` for observability and render "Could not load history (try again)" instead of "No imports yet." Mirror for `exportJobsResult`. ~10 LOC.

Surfaced 2026-05-27 by PR #1105 round-1 claude-bot review. Promoted from deferred 2026-05-29.

### `[LIFT]` Tighten `DbSyncResponseSchema` to drop `.passthrough()`

`packages/common-types/src/schemas/api/admin-operations.ts` declares `DbSyncResponseSchema` with `.passthrough()` because the api-gateway handler spreads an operation-result object with fields that vary per Prisma migration. The bot-client's `db-sync.ts` reads these via `as SyncResult` cast, bypassing compile-time checking.

**Fix shape**: declare the full response shape in the schema (mirror `AdminCleanupResponseSchema`'s tightening done in PR-2c) — `stats` becomes `z.record(z.string(), z.object({ devToProd: z.number().optional(), prodToDev: z.number().optional(), conflicts: z.number().optional() }))`, `warnings`/`info` become `z.array(z.string()).optional()`, etc. Drop `.passthrough()` and the `as SyncResult` cast in the bot-client. ~25 LOC schema + drop the cast + the local `SyncResult` interface.

Surfaced 2026-05-27 by PR #1104 round-3 claude-bot review. Promoted from deferred 2026-05-29.

### `[LIFT]` Tighten `LlmConfigSummarySchema` + drop `updatePreset`/`updateGlobalPreset` `Record<string,unknown>` casts

`packages/common-types/src/schemas/api/llm-config.ts` declares `LlmConfigSummarySchema` with `.passthrough()` because the gateway emits preset fields the bot-client dashboard reads (`contextWindowTokens`, `params`, `modelContextLength`) that the schema doesn't declare. The `toPresetData`/`toAdminPresetData` bridges in `services/bot-client/src/commands/preset/api.ts` then cast `config as PresetData`, and `updatePreset`/`updateGlobalPreset` take `data: Record<string, unknown>` cast to `Parameters<UserClient['updateUserLlmConfig']>[1]` — both bypass compile-time checking.

**Fix shape** (mirrors the `DbSyncResponseSchema` tightening above): enumerate the full preset shape in `LlmConfigSummarySchema` — `contextWindowTokens: z.number()`, `modelContextLength: z.number().optional()`, `params: <the sampling/reasoning object the dashboard reads>` — and drop `.passthrough()`. Then export named input types from common-types (`LlmConfigCreateInput`, `LlmConfigUpdateInput`) and retype `updatePreset`/`updateGlobalPreset`/`createPreset` to accept those instead of `Record<string, unknown>`, removing the `Parameters<...>` casts. Capture in the PR exactly which fields the dashboard reads vs. what the schema declares so the gap is closed precisely.

Note: SSRF path-encoding coverage for the LlmConfig client methods is NOT a gap — `packages/common-types/src/clients/generated-encoding.test.ts` sweeps `getUserLlmConfig`/`getGlobalLlmConfig` and the codegen template guarantees uniform `encodeURIComponent` on every `:param`. The consumer-layer URL-encoding tests removed in PR-2k were genuinely redundant.

Surfaced 2026-05-29 by PR #1114 claude-bot review (rounds 1–6). Natural companion to the `DbSyncResponseSchema` tightening and a good fit to fold into PR-2l's cleanup pass.

### `[LIFT]` Extract `@tzurot/clients` (or `@tzurot/routes`) from common-types (PR-2m)

`pnpm ops xray --summary common-types` at PR-2l close: **154 files / ~591 declarations**, well over the `01-architecture.md` heuristic (50 exports / 3000 lines). PR-1/PR-2 added the route manifest, transport helpers, and three generated client classes — a self-contained chunk that's the natural extraction candidate.

**Fix shape**: move `src/routes/` (manifest + types) and `src/clients/` (transport + `_generated/` + `gatewayClientStubs`-adjacent helpers) into a new `@tzurot/clients` package; common-types keeps domain types/constants/utils. Update imports across services (likely large but mechanical — most consumers import from the package root). **Why its own PR**: extraction is a design task (package boundary, circular-dep avoidance, build wiring), not teardown. Surfaced 2026-05-29 by PR-2l Step 6 export audit (the deferred "re-check common-types export count post-PR-2" item, now resolved with this follow-up).

### `[FEAT]` Enrich forwarded-message context with origin channel/thread (not just forwarding channel)

`SnapshotFormatter.formatSnapshot` (`services/bot-client/src/handlers/references/SnapshotFormatter.ts`) currently labels forwarded snapshots with the **forwarding** channel's `locationContext` + "(forwarded message)" — it does NOT surface the _origin_ channel/thread the message was forwarded FROM. The inline comment ("snapshot doesn't have it") is accurate about the snapshot object, but the origin `channelId`/`guildId` ARE available on `forwardedFrom.reference` (the `FORWARD`-type `MessageReference`). Discord's own client resolves that ID to show e.g. "#general · 05/09/2026" on the forward. The original **timestamp** is already captured (`snapshot.createdTimestamp`, falls back to the forward's time) — only the origin location is missing.

**Fix shape**: read `forwardedFrom.reference?.channelId` / `.guildId`; best-effort resolve the channel name via `client.channels.fetch()` and include it in `locationContext` (e.g. "forwarded from #general"). **Hard caveat**: Discord allows cross-server forwards, and the bot often won't be a member of the origin guild/channel → the fetch fails. Must degrade gracefully (bare ID, or omit) rather than throw or stall. Worth weighing whether a bare channel ID adds any value to the AI's context vs. just noise — possibly only include when the name resolves.

**Why minor**: forwarded-message origin is situational-awareness nice-to-have for the AI, not a correctness issue; the content, timestamp, attachments, and embeds are all already captured. User-flagged 2026-05-29 as explicitly out-of-scope for the current release.

### `[LIFT]` Split `/character chat`'s random mode into a separate `/character random` command

**Surfaced 2026-05-29** (user). `/character chat` is currently trimodal — (1) chat with a named character + message, (2) weigh-in mode (named character, no message), (3) random-pick (no character → picks one). The combined surface is confusing for the average user: it's not obvious from the signature which mode you're invoking, and "omit the character to get a random one" is easy to miss or trigger by accident.

**Direction (user)**: pull random-pick into its own `/character random` command so each command's purpose is legible from its name. **Keep weigh-in mode in `/character chat`** — it still requires picking a character, so it fits the "chat" mental model. Goal: split with zero loss of current functionality.

**Open design question**: does `/character random` get the optional `message` arg (parity with chat), or is it message-less (pure "surprise me")? Both defensible — decide during design, not now.

**Why inbox (not scheduled)**: explicitly NOT for beta.126; it's a UX-restructure with an unresolved design question, so it needs triage + a design pass before becoming a committed task. Touches `services/bot-client/src/commands/character/chat.ts` (mode branching), the slash-command definition, and `randomPick.ts`. Command-structure change → integration snapshots need updating (`pnpm test:int`).
