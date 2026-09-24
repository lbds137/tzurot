---
id: TASK-815
title: >-
  Cut the ambient session-start context load (~150k tokens before the first
  prompt)
status: To Do
assignee: []
created_date: '2026-08-29 11:24'
updated_date: '2026-09-24 01:52'
labels:
  - 'area:repo'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 815000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner observation 2026-08-29 — sessions routinely sit near 150k tokens of ambient context before any work begins, and the cost is paid on EVERY main-loop tool call (10-working-posture § Delegation posture: each call re-bills the full context, and per-call cost scales with context length). So ambient bytes are not a one-time load, they are a multiplier on the whole session.

MEASURED (bytes on disk, 2026-08-29; ~4 bytes/token):
- .claude/rules total 163309 B, about 41k tok — GUARANTEED every session. Worst first: 00-critical 27438, 06-backlog 24549, 05-tooling 21088, 03-database 19443, 02-code-standards 19079, 10-working-posture 15989, 04-discord 13673, 07-documentation 10521, 09-interaction-style 6474, 01-architecture 5055.
- Skill bodies 151977 B total, about 38k tok: git-workflow 49604, review-response 34317, orchestration 31545, testing 14119, session-mining 12146, docs 7072, reuse-scout 3174.
- MEMORY.md index 7494 B (auto-loaded). The 25 individual memory files total 72240 B but are recall-gated, not guaranteed.
- CURRENT.md 10411, BACKLOG.md 6856, CLAUDE.md 6342, global CLAUDE.md 1819.

BIGGEST LEVER FOUND, and it is not what the owner or I assumed: the COMPACTION SUMMARY REPLAYS INVOKED SKILL BODIES IN FULL (partially truncated). A post-compaction session that had invoked six skills carried roughly 145000 B of skill text, about 36k tok, as pure duplication — those procedures were already consumed and are re-invokable on demand. This is why the number is worse AFTER compaction, which is exactly when the owner noticed it. Rules are the top term for the pre-compaction floor; skill replay is the top term post-compaction.

External lead the owner supplied (xda-developers, Claude Code using 50k tokens before a typed prompt): its levers are disable unused PLUGINS (saved 5800 tok), disable AUTO-MEMORY (about 4000 tok), prune custom skills (negligible for them), and use /context to get the authoritative breakdown. Its baseline split was system prompt 10700, system TOOLS 28500, plugin skills 6300, agents 943. Note two things: our deferred-tool loading already mitigates their single largest line, and their whole 51k baseline is smaller than our rules-plus-skills surface alone — so their levers are secondary here and our own surfaces dominate.

Fix shape, measure before cutting: (1) run /context in a fresh session AND in a post-compaction session and record both — that is the authoritative breakdown; file measurements above are only a proxy and do not see the system prompt or tool schemas. (2) Confirm or refute the skill-replay finding from the two /context readings; if confirmed it is the highest-value target and may be addressable by compaction instructions rather than by trimming any file. (3) Only then trim rules — note pnpm ops lines:check ALREADY ratchets this surface and it currently sits at 2229 lines against a 2273 limit with a 2123 baseline, so the budget has been ratcheted upward over time; the honest move is to lower the baseline, not raise the limit again. /tzurot-doc-audit § economy pass consumes lines:check --breakdown as its trim order. (4) Check whether the auto-memory index plus recall traffic earns its roughly 1.9k floor.

CARE: rules are load-bearing constraints and several exist because a specific failure recurred. Trimming is a doc-audit judgement per surface, NOT a byte-count exercise — 07-documentation already says always-loaded surfaces carry the constraint and not the archaeology, which is the criterion to apply.

This task is agent-generated process work and counts against the drain net.

Acceptance: /context readings recorded for both a fresh and a post-compaction session; the skill-replay hypothesis confirmed or refuted against them; and either a measured reduction with the lines:check baseline lowered to match, or a recorded decision that the current load is the right trade with the reason.

HARNESS CEILING (2026-09-23): Claude Code 2.1.281 now shows at startup "12 instruction files add up to 175.7k chars, over the 150.0k-char total limit" (the 12 = ~/.claude/CLAUDE.md + CLAUDE.md + the 10 rules; `wc -m` total 175,709). Read from the binary, not docs: the numbers feed only the `large-memory-files` warning banner and the doctor line "Instruction files will impact performance" (functions Rwt/Cwt/Uje/Jbn); no truncation or drop path was found, so every file still loads in full. The total limit is max(120000, per-file limit), and the per-file limit is max(40000, round(context window x 0.05 x a model factor)): 150,000 on the 1M-context Opus 5.5 session, likely the 120k floor on a 200k-context model. Measured by content.length (UTF-16 units), not bytes. Our own gate missed it: lines:check caps the rules at 178,630 BYTES and never counts CLAUDE.md. The skill-replay finding is confirmed by observation in that same post-compaction session: its context carried three invoked skill bodies (usage-audit, review-response, orchestration) replayed after the boundary. Rules half (step 3) dispatched the same day: CLAUDE.md + rules to <=140,000 chars, plus a hard harness-mirroring ceiling in lines:check. Steps 1 and 4 (the /context readings, the auto-memory floor) stay open.

/context READING 1, POST-COMPACTION (2026-09-23, Opus 5.5 1M, before the rules trim lands): 189k used. System prompt 2.4k, system tools 17.2k, custom agents 0.1k, MEMORY FILES 65.8k, skills listing 5.5k (40 skills; the claude.ai-synced office skills are ~1.4k of it), messages 98.1k, autocompact buffer 33k. MCP tools (41.7k) and deferred system tools (24.6k) show as deferred at 0 tokens actual, so the xda lead's largest lever is already mitigated here. Memory files = the 12 instruction files (175,709 chars) + MEMORY.md (9,048 chars) = 184,757 chars for 65.8k tokens, about 2.8 chars/token. So lines:check's token figure (bytes/4, via formatTokenEstimate in lines-breakdown.ts) UNDER-reports this markdown by about 1.4x: it prints the rules as ~42k tok, while the measured ratio puts them near 59k. Recalibrate that divisor against this reading (it is display-only; nothing gates on it). The 98.1k messages line includes the compaction summary, the CURRENT.md injection, and three replayed skill bodies; this reading cannot separate them. Still needed for step 1: the same reading at the start of a FRESH session.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-09-24 01:52
---
Rules half SHIPPED 2026-09-23 in PR #2494 (e375266da): CLAUDE.md + rules 173,337 -> 134,238 chars (wc -m); lines:check gains a hard 147,000-char .length ceiling (lines-ceiling.ts) outside the baseline ratchet; rules baseline ratcheted down to 1738 lines / 128,643 bytes; the lines:check token estimate recalibrated to 2.8 bytes/token from the post-compaction /context reading. Still open: step 1 (a FRESH-session /context reading to pair with the post-compaction one) and step 4 (the auto-memory index floor).
---
<!-- COMMENTS:END -->
