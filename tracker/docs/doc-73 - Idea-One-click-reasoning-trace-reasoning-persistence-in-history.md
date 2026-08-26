---
id: doc-73
title: 'Idea: One-click reasoning trace + reasoning persistence in history'
type: other
created_date: '2026-08-10 23:51'
---

_Owner request 2026-08-10 ("for whenever"): they use the reasoning trace often
and want it one click away and durable._

Three parts, filed together because they share the reasoning-trace surface:

1. **One-click context-menu shortcut.** Today: message context menu → Inspect
   → click "View Reasoning". Wanted: a "View Reasoning" app context-menu
   command that jumps straight to the trace. Discord caps installed
   context-menu commands (check the app-command budget before adding);
   otherwise mostly a bot-client routing exercise over the existing /inspect
   reasoning renderer.

2. **Persist the reasoning trace with conversation history** so it can be
   viewed any time within the 30-day history retention
   (`DAYS_TO_KEEP_HISTORY`), independent of /inspect. `thinkingContent` is
   already extracted in ResponsePostProcessor — persistence means carrying it
   onto the history row (new nullable column or JSONB field; null-semantics
   doc required per 03-database). Scoping questions: storage growth (reasoning
   is often KBs per message — measure average trace size before choosing
   column vs side table), whether the view path needs its own permission
   check (reasoning may reference other channel members' messages), and
   sync-table impact (conversation history is ephemeral/not synced — verify).

3. **The /inspect diagnostic window** (`llm_diagnostic_logs`, currently 24h
   cleanup in CleanupDiagnosticLogs): owner floated widening to ~7d, decision
   deliberately open ("idk"). If part 2 ships, the trace itself no longer
   needs /inspect's window — /inspect stays the deep-diagnostic surface
   (prompt assembly, token budget, timings), which may argue for keeping it
   short. Measure row size × daily volume before widening (full payloads are
   large — the 479b3251 row alone was ~46KB).

Context that makes this timely: the glm-4.5-air mis-channel incident
(2026-08-10) put the user's real reply in the trace — the owner's frequent
trace usage is partly triage for that class. The watch WARN (PR #2057) may
reduce the urgency but not the general utility.

---

## DESIGN (Fable session 2026-08-14; measurements read-only from prod)

### Measurements that settle the doc's open questions

| Question the doc asked | Measured answer (prod, 2026-08-14) |
| --- | --- |
| Average trace size (column vs side table) | **4.7 KB avg, 17 KB max**; 103 of 108 generations (95%) carry a trace |
| History-persistence growth | ~132 assistant rows/day × 4.7 KB ≈ **620 KB/day → ~19 MB steady state at 30d** — roughly doubles the 22 MB `conversation_history` table. Trivial: **nullable column wins**, a side table adds a join for nothing at this scale |
| /inspect window widening (24h → 7d) | 108 rows/day × 78 KB avg row (the bulk is `assembledPrompt`, NOT the trace — traces are only 477 KB of the 8.5 MB window) → 7d ≈ **60 MB** of mostly-prompt payloads |
| Discord context-command budget | **15 global MESSAGE commands** (docs.discord.com, fetched 2026-08-14 — the old 5 limit is history) |

### Part 2 decision — persist the trace as a nullable column

`thinking_content TEXT?` on `conversation_history`, written where the assistant
row is persisted, from the same `thinkingContent` the post-processor already
extracts. Null-semantics doc (03-database, deferred-set pattern): `/// Null when
the model produced no reasoning trace (5% of generations) or the row predates
trace persistence; populated at row creation otherwise.` **Sync impact,
verified 2026-08-14: `conversation_history` IS in `syncTables.ts`** — the
original doc's "verify (probably ephemeral)" hedge resolved the other way. The
column rides row-level sync automatically once both envs carry the migration;
honest cost is ~19 MB more sync payload at steady state, LWW untouched (the
column is written once at row creation). Retention: rides the existing 30d
history cleanup untouched — the column dies with its row.

**Wire path (grounded)**: `thinkingContent` already travels ai-worker →
bot-client in the job-result metadata (the `show_thinking` chain:
GenerationStep → SlotDeliveryService → DiscordResponseSender), so persistence
is a forward, not a new extraction: bot-client adds optional `thinkingContent`
to the POST `/api/internal/conversation/assistant-message` body
(`conversationAssistantMessage.ts`), and `historyService.addMessage` writes the
column. **Seam obligation (02-code-standards rule 7)**: the new key must be
declared in the internal endpoint's Zod wire schema or strip-mode silently
deletes it — pin with a sentinel-survival test at the boundary, plus one
sequencing test asserting the row carries the trace after the real chain runs.

### Part 1 spec — the "View Reasoning" context-menu command (everything exists but the jump)

Code map (Explore sweep 2026-08-14): the whole render path is already built —
this command is pure routing.

- **Template**: `inspectMessage.ts` (the one existing message-context command;
  `defineContextMenuCommand()` + `CommandHandler.handleContextMenuCommand`,
  which defers ephemeral before the handler runs). Budget: this makes **2 of
  15** global MESSAGE commands — no pressure.
- **Resolution**: reuse `inspect/lookup.ts` — `getDiagnosticByMessage(id)` with
  the `getDiagnosticByResponse(id)` fallback, so right-clicking either the
  trigger or the reply resolves. Permissions are already server-side (owner
  sees all; others only their own) via the `X-User-Id` header — the new
  command inherits them by calling the same client.
- **Render**: call `buildReasoningView()` (`inspect/views.ts:228`) directly —
  chunked ephemeral output, 10-chunk cap, `reasoning-full.txt` overflow. No new
  renderer, no new components.
  **Correction (grounded 2026-08-14, build session)**: the line above originally
  said "then `renderViewResult()`". That function is **private to
  `inspect/index.ts:70`** and typed
  `StringSelectMenuInteraction | ButtonInteraction`, so a
  `MessageContextMenuCommandInteraction` does not fit it. Two honest options —
  export it and widen its interaction type (it only forwards to
  `sendChunkedReply` / `editReply`, both of which accept the wider type), or
  call `sendChunkedReply` directly from the new command. Prefer widening and
  exporting: `buildReasoningView` returns a `DebugViewResult`, and duplicating
  the branch that unpacks it is exactly the two-places-that-can-disagree shape
  `/tzurot-reuse-scout` targets.
- **Empty case** (5% of generations, plus expired diagnostics until part 2):
  a friendly ephemeral "No reasoning trace for this message" naming the reason
  when known (`thinking_extraction: skipped` vs diagnostic-not-found), with a
  hint that full `/inspect` exists for the deep view.
- **Tests**: unit for the resolution/fallback branches + `pnpm test:component`
  (command-structure snapshot changes).

### Part 3 decision — keep the /inspect window at 24h

Once part 2 ships, the trace outlives /inspect on its own row, so the only
things the 24h window still bounds are the deep diagnostics (prompt assembly,
timings, token budget) — triage material that goes stale in hours anyway.
Widening to 7d would 25× a mostly-prompt payload store to make durable a thing
part 2 already made durable. **Closed: no widening.**

#### REVERSED 2026-08-26 — the window IS now 7d (owner call, PR #2231)

`RETENTION_HOURS` is `7 * 24`, and the privacy policy moved with it. This is a
deliberate reversal of the decision above, not a session that failed to find it:
the owner asked for the bump, the claude-review on #2231 surfaced this Part 3
decision before merge, and the owner re-decided with these numbers in view.

What actually changed the answer:

- **The storage objection is weaker than the prose above claims.** "25×" does not
  match this doc's own measurement — 8.5 MB at 24h to ≈60 MB at 7d is about 7×,
  which is the window multiple. 60 MB total is negligible for this Postgres, so
  cost was not the deciding axis either way.
- **"Triage material that goes stale in hours anyway" is the clause that did not
  hold up.** Deep diagnostics go stale as a *live debugging* aid, but the reports
  that need them arrive late — this doc's own § Report Issue item records a
  tag-leak report that arrived >24h after the fact with the log already gone. A
  24h window guarantees the evidence is missing precisely when someone finally
  reports something.

Part 2's premise is unaffected and still correct: `thinking_content` is live
(`prisma/schema.prisma`), so the trace outlives the diagnostic window on the
history row for the full 30-day retention. The 7d window is about the deep
diagnostics beside it, not the trace.

Knock-on for § Report Issue: its evidence-pinning motivation is **weakened, not
removed** — a 7d window would have caught the specific incident it cites, but a
report arriving after a week still loses the log, so the pin-at-report-time
design keeps its value for the tail.

### PR split

- **PR 1 (size S)** — the context-menu command per the part-1 spec. Ships
  alone; useful from day one against the 24h diagnostic window.
- **PR 2 (size M)** — persistence: additive migration (nullable
  `thinking_content` + null-semantics doc comment; build session loads
  `/tzurot-db-vector` for the migration procedure), internal-endpoint schema +
  bot-client forward, `addMessage` write, and PR 1's command gains the
  fallback: diagnostic expired → look up the history row by
  `discordMessageId` and render `thinking_content` under the same
  owner-or-own-rows gate. Seam tests per the wire-path note above.
- **Sequencing with doc-77**: independent of the canonical-thinking-level PRs;
  either order works. The `show_thinking` retirement (doc-77 Cluster D) should
  land only AFTER PR 1 ships, so trace access never regresses to
  slash-command-only. The job-result `thinkingContent` metadata channel MUST
  survive that retirement — PR 2 depends on it; only the inline display toggle
  and `sendThinkingBlock` go.

