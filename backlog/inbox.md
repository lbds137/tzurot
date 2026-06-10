## 📥 Inbox

_New items go here. Triage to appropriate section weekly._

### `[LIFT]` Audit message-content extraction paths — confirm single source, document the layering, find re-derivation footguns

**Surfaced 2026-06-08** during the forwarded-trigger-empty-content investigation (see `backlog/production-issues.md`). The forward bug existed because `ReferenceExtractor` **re-derived** message content from `message.content` (empty for forwards) for its link-replacement step, silently clobbering the already-correctly-extracted forwarded text — a redundant second derivation that bypassed the shared extractor. The raw extraction itself is NOT duplicated (`getEffectiveContent` and `buildMessageContent` both bottom out in `extractForwardedContent`), but the layering is undocumented and the re-derivation footgun was invisible until it shipped a prod bug.

**Scope** (do NOT big-bang-merge `getEffectiveContent` and `buildMessageContent` — they serve different purposes: raw-text-for-rewriting vs rendered-content-for-display; merging would run mention-rewriting over attachment descriptions):
1. Enumerate every place that extracts a message's text content (`getEffectiveContent`, `buildMessageContent`, `ReferenceExtractor`, `DiscordChannelFetcher.convertMessage`, `ConversationPersistence`, `RawEnvelopeBuilder`, sync's `collateContentForSync`, etc.).
2. Confirm each flows from the one `extractForwardedContent` for forward text, and flag any that re-derive from `message.content` instead of using passed/authoritative content (the ReferenceExtractor class of bug).
3. Document the layering explicitly: raw-text path (trigger → rewriting) vs rendered path (history/display) vs persistence — and which is authoritative when they disagree.
4. Capture the **gateway-vs-REST snapshot asymmetry** as a first-class fact: forward snapshot content is present on the live `MESSAGE_CREATE` but absent on REST re-fetch (so any history/refetch path that expects forward content will get empty). Decide where this belongs (a code comment in `forwardedMessageUtils.ts`, or `docs/reference/`).
5. Consider structural enforcement: required-param contracts (no silent `message.content` defaults) wherever content-rewriting takes a base text.

**Why a LIFT, not a quick fix**: the immediate forward bug gets a targeted fix; this audit is the systematic follow-up that prevents the next divergence, scoped after the fix lands so it has a concrete anchor.

### `[CHORE]` Integration coverage never collects `services/**`

**Surfaced 2026-06-07** during the beta.128 codecov/patch failure. `vitest.int.config.ts`'s coverage `include` is `['src/**/*.ts', 'packages/**/src/**/*.ts']` — both root-relative, so no `services/*/src` file has ever appeared in the integration coverage upload. The `integration` codecov flag claims `services/` in its paths but receives no matching data; every service line exercised only by int tests reads as uncovered.

**Fix shape**: add `services/**/src/**/*.ts` to the include list. Do it as a standalone PR, not mid-release — real int coverage landing for three services will shift global coverage numbers and may need a codecov-baseline conversation. (The conformance fixtures stay codecov-ignored as test infrastructure regardless — that part is intentional, not a workaround.)

### `[FEAT]` Enrich forwarded-message context with origin channel/thread (not just forwarding channel)

`SnapshotFormatter.formatSnapshot` (`services/bot-client/src/handlers/references/SnapshotFormatter.ts`) currently labels forwarded snapshots with the **forwarding** channel's `locationContext` + "(forwarded message)" — it does NOT surface the _origin_ channel/thread the message was forwarded FROM. The inline comment ("snapshot doesn't have it") is accurate about the snapshot object, but the origin `channelId`/`guildId` ARE available on `forwardedFrom.reference` (the `FORWARD`-type `MessageReference`). Discord's own client resolves that ID to show e.g. "#general · 05/09/2026" on the forward. The original **timestamp** is already captured (`snapshot.createdTimestamp`, falls back to the forward's time) — only the origin location is missing.

**Fix shape**: read `forwardedFrom.reference?.channelId` / `.guildId`; best-effort resolve the channel name via `client.channels.fetch()` and include it in `locationContext` (e.g. "forwarded from #general"). **Hard caveat**: Discord allows cross-server forwards, and the bot often won't be a member of the origin guild/channel → the fetch fails. Must degrade gracefully (bare ID, or omit) rather than throw or stall. Worth weighing whether a bare channel ID adds any value to the AI's context vs. just noise — possibly only include when the name resolves.

**Why minor**: forwarded-message origin is situational-awareness nice-to-have for the AI, not a correctness issue; the content, timestamp, attachments, and embeds are all already captured. User-flagged 2026-05-29 as explicitly out-of-scope for the current release.

### `[LIFT]` Split `/character chat`'s random mode into a separate `/character random` command

**Surfaced 2026-05-29** (user). `/character chat` is currently trimodal — (1) chat with a named character + message, (2) weigh-in mode (named character, no message), (3) random-pick (no character → picks one). The combined surface is confusing for the average user: it's not obvious from the signature which mode you're invoking, and "omit the character to get a random one" is easy to miss or trigger by accident.

**Direction (user)**: pull random-pick into its own `/character random` command so each command's purpose is legible from its name. **Keep weigh-in mode in `/character chat`** — it still requires picking a character, so it fits the "chat" mental model. Goal: split with zero loss of current functionality.

**Open design question**: does `/character random` get the optional `message` arg (parity with chat), or is it message-less (pure "surprise me")? Both defensible — decide during design, not now.

**Update 2026-06-09 (user)**: reconsider whether **weigh-in also deserves its own command** (e.g. `/character weighin`) rather than staying folded into `/character chat`. The 2026-05-29 direction was "keep weigh-in in chat," but weigh-in turns out to have genuinely _divergent context semantics_, not just a different arg shape: no invoking-user persona, no LTM read/write, and (after the epoch fix) **no STM-reset epoch cutoff** — it's a channel-scoped anonymous summon, not a personal chat turn. That semantic gap is itself an argument for a legible standalone command. Fold this into the same UX-restructure design pass; decide chat-vs-random-vs-weighin command topology together.

**Why inbox (not scheduled)**: explicitly NOT for beta.126; it's a UX-restructure with an unresolved design question, so it needs triage + a design pass before becoming a committed task. Touches `services/bot-client/src/commands/character/chat.ts` (mode branching), the slash-command definition, and `randomPick.ts`. Command-structure change → integration snapshots need updating (`pnpm test:int`).
