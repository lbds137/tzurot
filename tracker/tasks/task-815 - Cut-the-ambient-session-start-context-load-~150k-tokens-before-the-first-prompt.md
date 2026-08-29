---
id: TASK-815
title: >-
  Cut the ambient session-start context load (~150k tokens before the first
  prompt)
status: To Do
assignee: []
created_date: '2026-08-29 11:24'
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
<!-- SECTION:DESCRIPTION:END -->
