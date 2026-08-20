# Current

> **Version**: v3.0.0-beta.205 — "Characters know who they're talking to": sibling characters in the participants roster with resolvable `from_id` (#2143/#2144/#2159), generated roster blurbs shipped INERT behind `rosterBlurbEnabled: false` (#2148/#2149/#2150), quote binding by personality id (#2151), persisted guild info so S1 stops churning (#2152/#2160), forwarded-message attribution (#2141/#2142/#2162/#2164), embed clamps for the prod crash class (#2161/#2163), guest floor-hop rescue (#2155/#2157), z.ai reroute fix (#2153), `/chat` 4000-char input with chunked echo (#2154), model-catalog refresher (#2134). 30 PRs / 26 runtime / 339 files. 3 additive migrations premigrated to prod BEFORE the merge (`release:premigrate --force`, owner ran auto-mode off). Merged to main 2026-08-20 20:13 UTC via the documented FF path (rebase-merge choked mechanically on the ~150-commit range; gate fired + satisfied first); finalize no-op (FF keeps SHAs aligned); tagged + published; beta.204 demoted.
>
> **Previous**: v3.0.0-beta.204 — "count-cap hysteresis" (#2124 §2.5.2) + prompt-identity fixes (#2123/#2128/#2129/#2130/#2132). 7 PRs / 91 files. Merged 2026-08-17 23:52 UTC.

---

## 🚀 beta.205 SHIPPED (2026-08-20) — post-deploy checklist

Holistic release review: **no blocking findings** (verified notes-vs-diff, 17-package bump, all 3 migrations additive with null-semantics comments, cross-PR roster seams, `rosterBlurbEnabled: false` inert claim, no debug/secret leftovers). Privacy policy gained a "Server membership details" bullet for `user_guild_infos` — **owner: review the wording** (docs/legal/PRIVACY_POLICY.md, renders live at /privacy).

**Owner actions (in order):**

- [ ] **Repoint the guest free default → `glm-4.7`** once prod deploy settles. Required: post-#2153 the retired `glm-4.5-air` resolves via OpenRouter as a PAID model, so the free-guard would silently substitute `openrouter/free`.
- [ ] **Smoke: `/character edit` on `literal-crow-orev-kheshbon` (prod)** — the reported embed crash; fix shipped in #2161/#2163. PASS = the dashboard opens. Needs-smoke: the crash was runtime-confirmed on this exact character, and dev could not reproduce its imported payload.
- [ ] **Smoke: export-clear round-trip (beta.201 S1, deferred by owner to this batch).** On dev, pick a character with at least one genuinely **empty** optional field (or blank one out, e.g. appearance/likes) → `/character export` → `/character import` the JSON back. PASS = import succeeds AND the field is still empty afterward; FAIL = import error, or the field comes back filled with an old value. Judge by any field EXCEPT `customFields` (TASK-590, known-lossy gateway-side, excluded on purpose). Attachment-bearing (needs file upload). This is the ONLY carried attachment smoke item.

**Watches (log-signal, no action needed):**

- Floor-promotion rescue: ai-worker line `No hop-1 retarget available — promoting the floor to the hop-1 target` on the next prod rate-limit window clears the now.md guest entry (#2155/#2157 runtime-unverified until then).
- GLM (b): a retarget succeeding where a demoted turn previously dead-ended (now.md entry stays until hardening (b) lands).
- `rosterBlurbEnabled` stays **false** — flip gated on TASK-700 (blurb retry-storm hardening); the flip is a corpus-wide spend event and owner-timed.

## 📋 Open items (near-term)

- **Purge EXECUTED (owner-authorized 2026-08-16)**: 20 never-used accounts erased, 0 characters touched, userbase 228→208. Remaining: 1 reachable user awaits the warning DM — `retention:notify` NOT run (outward-facing; separate owner call).
- **Housekeeping**: `3f50da50.jsonl` (155MB, fully mined) is a disk-space deletion candidate — owner's explicit okay still needed.

## 🔧 DRAIN CAMPAIGN — standing; batching is the method

Backlog composition, measured: ~321 open = 107 `ready` · 97 `observable` · 57 `dependent` · 45 `owner` — only ~1/3 agent-drainable; filing rate (not staleness, measured ~3%) drives growth. **Themed batches over per-task PRs** (4-5 closes per cycle vs 1). Pre-grounded: 199+200 together (bare-run HEALTH_TOOLS shape); 349 and 457 solo (457 has a global-flag design call); held for owner: 527 (copy), 540 (HTTP contract), 559 (pick), 531 (process design); TASK-599 = the batched owner-decision pass over `state:owner`. Query, do not browse: `pnpm tracker task list -s "To Do" -l state:ready -l size:S --plain` (the `-s "To Do"` is load-bearing).

**Carry-forwards (all one shape — a check that can't distinguish measured-fine from didn't-measure)**: publish the command, never the hand-restated number; negative-control a FIX by running it; a probe that swallows stderr certifies broken code green (check other probes for `2>/dev/null` in invoke paths).

**Open rule-shaped gap, not yet drafted**: five of #2097's last six defects entered _while fixing a previous finding_ — every countermeasure fires at authoring time, none at correction time. Wants a council pass (TASK-531 adjacent).

## 🧵 Standing threads (durable)

- **Voice-consistency harness BUILT (#1910/#1911); remaining: the owner's ~15-min sitting** — blind-review `reports/voice-consistency/judgment-sheet.md` → `pnpm eval:voice-verdict`. Judge preview: A-vs-B 5/5/8, B-vs-B′ control 8/18 (the pre-registered under-power flag may trip — read the noise-floor line before trusting a PASS). Artifacts backed up (`voice-consistency-2026-08-04.tar.gz`). **Owner's leisure — do not re-surface as a recommendation.** Phase 2 (history extraction) + the #1317 cluster + TASK-165 stay gated behind it.
- **Opus trial record**: TASK-513 (owner decision surface) + TASK-487 (Sonnet-tier evidence ledger). Orchestrator failure shape: a check that inherits the assumption it tests → canary, Core Principle 9.
- Owner-idea council queue: doc-64 (meta-harness spinoff; license recorded), doc-65 (private brain), doc-66 (message coalescing), doc-67 (tag-scoped sharing), doc-70/71/72 (tag mgmt/dashboard nav).
- Waffles' venue-leak report: awaiting their Share Memories answer (doc-8 carries the design input either way).
- TASK-514 (mis-channel WARN watch) · TASK-425/426/410 (beta.191 threads; bullmq/ioredis v6 pending, dependabot-ignored until then) · 55 doubled-transcript rows age out ~Sep 2 · doc-59 (BYOK video).
- **Owner decisions locked** (still governing): no asset table for attachments · descriptions live 30d keyed to `DAYS_TO_KEEP_HISTORY` · direct replies always re-vision · extended context re-visions only within retention · undescribed old images render a presence note · extended-context quota exemption AFTER persistence · `maxImages` is a spend cap · moderator cascade (TASK-529) + shared-persona-name collision (TASK-528, key by personaId) fix shapes recorded.
- **Retention is calendar-only**: books as of 2026-08-09 — 221+ users, 5 in earlier grace (~08-26 expiries) + 2 warned (~09-08). Phase 4 autonomy parked BY DESIGN. Dev nag now silenced by #2120's prod gate.
- **doc-78 — DM Context Isolation: DESIGN SETTLED + GROUNDED** (enum `shareHistoryAcrossPersonalities`, default `always`; no migration). Full design + 7 registration sites + runtime evidence in tracker doc-78.
- **TASK-671 — memory recirculates stale facts**: step 0 is one string (`MEMORY_ARCHIVE_INSTRUCTION` never mentions time — owner's catch); a concrete argument on doc-8's FOR side.
