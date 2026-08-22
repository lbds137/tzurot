# Current

> **Version**: v3.0.0-beta.205 — "Characters know who they're talking to": sibling characters in the participants roster with resolvable `from_id` (#2143/#2144/#2159), generated roster blurbs shipped INERT behind `rosterBlurbEnabled: false` (#2148/#2149/#2150), quote binding by personality id (#2151), persisted guild info so S1 stops churning (#2152/#2160), forwarded-message attribution (#2141/#2142/#2162/#2164), embed clamps for the prod crash class (#2161/#2163), guest floor-hop rescue (#2155/#2157), z.ai reroute fix (#2153), `/chat` 4000-char input with chunked echo (#2154), model-catalog refresher (#2134). 30 PRs / 26 runtime / 339 files. 3 additive migrations premigrated to prod BEFORE the merge (`release:premigrate --force`, owner ran auto-mode off). Merged to main 2026-08-20 20:13 UTC via the documented FF path (rebase-merge choked mechanically on the ~150-commit range; gate fired + satisfied first); finalize no-op (FF keeps SHAs aligned); tagged + published; beta.204 demoted.
>
> **Previous**: v3.0.0-beta.204 — "count-cap hysteresis" (#2124 §2.5.2) + prompt-identity fixes (#2123/#2128/#2129/#2130/#2132). 7 PRs / 91 files. Merged 2026-08-17 23:52 UTC.

---

## 🚀 beta.205 SHIPPED (2026-08-20) — post-deploy checklist

Holistic release review: **no blocking findings** (verified notes-vs-diff, 17-package bump, all 3 migrations additive with null-semantics comments, cross-PR roster seams, `rosterBlurbEnabled: false` inert claim, no debug/secret leftovers). Privacy policy gained a "Server membership details" bullet for `user_guild_infos` — wording **approved by owner 2026-08-20**.

**Owner actions (in order):**

- [x] **Repoint the guest free default → `glm-4.7`** — DONE (owner, 2026-08-20 post-deploy). Required: post-#2153 the retired `glm-4.5-air` resolves via OpenRouter as a PAID model, so the free-guard would silently substitute `openrouter/free`.
- [x] **Smoke: `/character edit` on `literal-crow-orev-kheshbon` (prod)** — **PASS** (owner, 2026-08-20): the dashboard opens. The #2161/#2163 clamp fix is now runtime-confirmed on the exact payload that crashed prod.
- [x] **Smoke: export-clear round-trip (beta.201 S1)** — **PASS** (owner, 2026-08-20): cleared the crow's age field → export → reimport → field still blank. Original instruction kept for the record: On dev, pick a character with at least one genuinely **empty** optional field (or blank one out, e.g. appearance/likes) → `/character export` → `/character import` the JSON back. PASS = import succeeds AND the field is still empty afterward; FAIL = import error, or the field comes back filled with an old value. Judge by any field EXCEPT `customFields` (TASK-590, known-lossy gateway-side, excluded on purpose). Attachment-bearing (needs file upload). This is the ONLY carried attachment smoke item.

**Watches (log-signal, no action needed):**

- Floor-promotion rescue: ai-worker line `No hop-1 retarget available — promoting the floor to the hop-1 target` on the next prod rate-limit window clears the now.md guest entry (#2155/#2157 runtime-unverified until then).
- GLM (b): a retarget succeeding where a demoted turn previously dead-ended (now.md entry stays until hardening (b) lands).
- `rosterBlurbEnabled` stays **false** — flip gated on TASK-700 (blurb retry-storm hardening); the flip is a corpus-wide spend event and owner-timed.

## ▶️ NEXT UNIT — beta.206 sub-theme 1 (the forward batch)

**Done:** TASK-706 (#2166), TASK-668 (#2167), TASK-708 PR 1 (#2168), TASK-710 (#2169), TASK-712 (#2170), TASK-43 probe (#2171), TASK-716 (#2172) — all merged 2026-08-21. **TASK-710, TASK-712 and TASK-716 are CLOSED** (710 a behaviour-preserving extraction; 712 a tightening whose changed behaviour is only visible to a forwarder LACKING access, which a smoke cannot stage). 706, 668 and 708 stay OPEN pending the smoke queue below.

**Next, in order:** TASK-718 skill edit (4 clean nested units on the ledger; review-gated PR) → Phase 2 PR 2.1 (`StructuredHistoryEntry` typed IR, byte-parity, absorbs TASK-683 — spec derives from §9c, design settled). TASK-700 SHIPPED (#2177, dev migration applied) — sub-theme 2 code half done; the blurb flip is ungated and owner-timed.

**TASK-708 PR 2 SHIPPED** (PR #2175, merged `87bf8a467`) — the council's match-gated prefix strip in `QuoteFormatter.formatQuoteElement`, plus review-round additions: `fromFallback` (an unresolved forward's `'Unknown'` placeholder renders `from=` without entering the comparison), the two prefix regexes consolidated to one, and the ACCEPTED RESIDUAL doc naming all three bounded residual sources. Built via the nested-delegation pattern (data point 2 recorded on TASK-718). TASK-708 now closes on its PR 1 smoke alone.

**TASK-43 re-scoped, not built.** Its filed blocker ("MessageSnapshot strips mention metadata") is FALSE at the type level — re-verified against the shipped typings. The probe shipped in #2171 answers the half a declaration cannot; the fix shape is chosen from its result, not before it.

**Filed this session, all tracked:** TASK-714 (embed XML emits the original URL while vision fetches the proxy), TASK-715 (**Done** — shipped in the PR that filed it), TASK-716, TASK-717 (**Done** — the throws-for-non-member premise was CONFIRMED by a live probe, `DiscordAPIError[10007]`/404; docstring cites it, #2173).

Constraint from the design refresh: fixes land as ENTRY-METADATA shapes Phase 2 carries, not chat_log XML attributes it deletes (`prompt-assembly-architecture.md` §9c). Phase 2 build specs derive from §9c — design is settled, no re-litigating.

## 🔬 beta.206 smoke queue (batch at release kickoff — do NOT drip-feed)

- [ ] **Forward attribution in extended context** (TASK-706 / #2166) — _needs-smoke: the fix is pinned at the seam by unit tests, but no runtime observation exists yet; the whole bug class was "code looked right, path never ran."_
  - **Repro**: in dev, post a forward into a channel where the bot is **NOT** activated. Then, on a **later** message in that same channel, trigger a character (any character, any trigger style).
  - **Invariant**: the forward must reach the model attributed, on a turn AFTER the one that created it. The trigger-message path already worked — this is specifically the ambient/non-trigger case.
  - **Masking state**: if the same forward was already processed as a trigger, its attribution comes from the DB and proves nothing. Use a fresh forward the bot never responded to.
  - **Expect**: the quote renders with the original author's name and a `t=` timestamp. Failure looks like `from="Unknown"` with no `t=` — today's behavior.
  - **Report**: `/inspect` output or a debug payload is ideal; a pass/fail is fine.

- [ ] **Origin channel on a forwarded quote** (TASK-668 / #2167) — _needs-smoke: the visibility gate is pinned by unit tests from every angle, but no runtime observation exists that the name actually reaches the model. Same class as the item above — the code looked right there too._
  - **Repro**: in dev, forward a message **from a different channel** into one where a character will respond, then trigger a character on it. Any character, any trigger style.
  - **Invariant**: the quote carries the ORIGIN channel's name — where the forward came FROM, not where it landed.
  - **Masking state**: forward from a channel **you can see**. The gate is deliberately fail-closed on the forwarder's access, so a forward out of a channel you lack `ViewChannel` on will correctly render no channel at all — a real pass looks identical to a failure there.
  - **Expect**: `<quote type="forward" from="…" t="…" channel="origin-channel-name">`. Failure is the same quote with no `channel=` attribute.
  - **Optional second case** if convenient: forward from a **private thread you are in** → still named. Forward from a DM → no `channel=` at all, by design, not a bug.
  - **Report**: `/inspect` or a debug payload; pass/fail is fine.

- [ ] **Our own `-#` footer inside a forwarded quote** (TASK-708 PR 1 / #2168) — _needs-smoke: pinned by unit tests at seven sites and canaried, but no runtime observation. Same class as the two above — this bug was reported FROM runtime precisely because the code read fine._
  - **Repro**: in dev, get a character to reply so its message carries a visible `-# Model: …` footer. Then **forward that message** into a channel and trigger a character on it.
  - **Invariant**: the quoted text reaches the model with our subtext gone — no `-# Model:`, no `👻 Incognito Mode`, no `📍 auto-response`.
  - **Two paths worth hitting, they are different code**: (a) forward + trigger in the SAME message — that is the current turn; (b) **reply to** or **link to** an existing forward — that is the fan-out path the first round of review caught, and the one that most likely produced the original report.
  - **Expect**: `<quote type="forward">` containing only the character's prose. Failure is the footer still sitting inside the quote, exactly as first reported.
  - **Not a failure**: a forwarded HUMAN message whose own text uses `-#` subtext keeps it — that is deliberate and pinned by a test.
  - **PR 2 rider** (#2175): while smoking, also glance for a quoted message where a real user's own `**TheirName:** ` opener got stripped — the one user-visible change PR 2 adds; accepted residual (attribution survives in `from=`), but the owner should see it consciously once.
  - **Report**: `/inspect` or a debug payload; pass/fail is fine.

- [ ] **Rider on ANY of the three forward smokes above** (TASK-43 / #2171) — _no separate round needed._
  - **One extra requirement**: the forwarded message must contain an **at-mention in its own text** (`@someone`). Any of the three repros above works otherwise.
  - **Why it matters**: a forward with no at-mention logs a zero count, which reads as "Discord sends no mentions" when it is actually "nothing to send." That would settle the question the wrong way.
  - **Nothing to report by hand** — the probe writes it to the bot-client logs; the log line is `TASK-43 probe: forward mention sources`.

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
