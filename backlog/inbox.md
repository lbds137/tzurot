## 📥 Inbox

_New items go here. Triage to appropriate section weekly._

### `[LIFT]` Extract API contract + client packages from common-types (PR-2m) — IN PROGRESS

`common-types` is at **154 files / 28,763 lines / 976 exports**, well over the `01-architecture.md` heuristic. The route manifest + transport + generated client classes are a self-contained chunk.

**Approved design** (council 2026-06-02 — GLM 5.1 / Kimi K2.6 / Qwen 3.7 Max, unanimous): the original single-`@tzurot/clients` plan splits the API contract and creates a circular dep. Split into **two** packages by stability:

- **`@tzurot/api-contract`** — `schemas/api/*` + `routes/` (ROUTE_MANIFEST + types) + the api factories. Consumed by api-gateway, codegen (tooling), and api-client.
- **`@tzurot/api-client`** — `clients/` (transport, errors, generated `*-client.ts`). Depends on api-contract + common-types (constants/utils). Consumed by bot-client.

**Migration (4 sequential green-CI PRs):**

1. **Back-edge fix** (zero package churn): relocate `PreviewTokenSchema`/`PurgeTokenSchema` from `routes/types.ts` into `schemas/api/memory.ts` (their only consumer). Restores one-way `routes → schemas`.
2. **Bootstrap `@tzurot/api-contract`**: move `schemas/api/*` + `routes/` + api factories; repoint codegen (`packages/tooling`) + api-gateway imports. **Run depcruise BEFORE the move** — the api factories import `schemas/api/*`, so they must move too or common-types→api-contract reintroduces a cycle.
3. **Bootstrap `@tzurot/api-client`**: move `clients/`; codemod the ~20 bot-client import sites. **No re-export shims** — clients import `constants`/`types`/`utils` from common-types, so a transitional barrel re-export creates a `common-types → api-client → common-types` cycle. Bulk-rewrite imports instead.
4. **Prune** common-types; audit remaining surface.

**Why its own epic**: package-boundary design + circular-dep avoidance + build wiring. Surfaced 2026-05-29 by PR-2l Step 6 export audit; design ratified 2026-06-02.

### `[FEAT]` Enrich forwarded-message context with origin channel/thread (not just forwarding channel)

`SnapshotFormatter.formatSnapshot` (`services/bot-client/src/handlers/references/SnapshotFormatter.ts`) currently labels forwarded snapshots with the **forwarding** channel's `locationContext` + "(forwarded message)" — it does NOT surface the _origin_ channel/thread the message was forwarded FROM. The inline comment ("snapshot doesn't have it") is accurate about the snapshot object, but the origin `channelId`/`guildId` ARE available on `forwardedFrom.reference` (the `FORWARD`-type `MessageReference`). Discord's own client resolves that ID to show e.g. "#general · 05/09/2026" on the forward. The original **timestamp** is already captured (`snapshot.createdTimestamp`, falls back to the forward's time) — only the origin location is missing.

**Fix shape**: read `forwardedFrom.reference?.channelId` / `.guildId`; best-effort resolve the channel name via `client.channels.fetch()` and include it in `locationContext` (e.g. "forwarded from #general"). **Hard caveat**: Discord allows cross-server forwards, and the bot often won't be a member of the origin guild/channel → the fetch fails. Must degrade gracefully (bare ID, or omit) rather than throw or stall. Worth weighing whether a bare channel ID adds any value to the AI's context vs. just noise — possibly only include when the name resolves.

**Why minor**: forwarded-message origin is situational-awareness nice-to-have for the AI, not a correctness issue; the content, timestamp, attachments, and embeds are all already captured. User-flagged 2026-05-29 as explicitly out-of-scope for the current release.

### `[LIFT]` Split `/character chat`'s random mode into a separate `/character random` command

**Surfaced 2026-05-29** (user). `/character chat` is currently trimodal — (1) chat with a named character + message, (2) weigh-in mode (named character, no message), (3) random-pick (no character → picks one). The combined surface is confusing for the average user: it's not obvious from the signature which mode you're invoking, and "omit the character to get a random one" is easy to miss or trigger by accident.

**Direction (user)**: pull random-pick into its own `/character random` command so each command's purpose is legible from its name. **Keep weigh-in mode in `/character chat`** — it still requires picking a character, so it fits the "chat" mental model. Goal: split with zero loss of current functionality.

**Open design question**: does `/character random` get the optional `message` arg (parity with chat), or is it message-less (pure "surprise me")? Both defensible — decide during design, not now.

**Why inbox (not scheduled)**: explicitly NOT for beta.126; it's a UX-restructure with an unresolved design question, so it needs triage + a design pass before becoming a committed task. Touches `services/bot-client/src/commands/character/chat.ts` (mode branching), the slash-command definition, and `randomPick.ts`. Command-structure change → integration snapshots need updating (`pnpm test:int`).
