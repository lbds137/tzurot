---
id: TASK-373
title: >-
  Audit: content that QUOTES our control syntax — every parse site, not just
  thinking tags
status: To Do
assignee: []
created_date: '2026-07-31 01:23'
labels:
  - 'area:ai-worker'
dependencies: []
priority: medium
ordinal: 373000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Owner-requested 2026-07-30**, generalizing from TASK-372: _"it sounds like we need to be broader in our surface audit to catch any other similar bug classes."_ Sibling to TASK-368 but a DIFFERENT class — 368 is unenforced prose invariants; this is control-syntax-vs-content confusion.

**The class**: anywhere we scan model output (or user input) for control syntax, a QUOTED or discussed instance of that syntax is indistinguishable from a real one. TASK-372 is the proven instance: a reply quoting `` `<thinking>` `` had everything after it eaten as reasoning, truncating the user-visible message. The trigger was ordinary — the conversation was ABOUT thinking blocks.

**Why it will recur**: this product hosts AI characters, so users and models discuss model internals routinely, and the tag vocabularies we scan for keep growing (GLM ships new reasoning-tag names per revision). The false-positive surface grows with every tag added.

**Sites to enumerate (deterministically — grep the parse sites, do not sample)**:
- `services/ai-worker/src/utils/thinkingExtraction.ts` — reasoning tags. TASK-372 covers the unclosed-tag path; check the OTHER paths too (orphan closing tag, the Pass-2 generic extractors) for the same quoted-syntax exposure.
- The Chain-of-Extractors generally — every extractor that pattern-matches on tag shapes.
- `promptSanitizer` PROTECTED_TAGS / `neutralizeWrapperClosingTags` — the escaping side. Different direction (we escape content so it cannot break OUT), so it may already be correct; verify rather than assume, and note WHY it is safe if it is, since that reasoning is exactly what 368 says should be executable.
- The `<action>`-tag leak item (now.md Untriaged) — its proposed generic unknown-wrapper handler would be a NEW parse site, so it must be designed against this class from the start rather than retrofitted.
- Anywhere else that regexes model output for angle-bracket or fence-delimited structure.

**Test shape (applies to every site found)**: feed content that QUOTES the delimiter mid-prose and assert the output is unchanged — nothing extracted, nothing truncated. Verify RED where the site is actually broken.

**Discriminators worth evaluating once, then applying consistently** (rather than per-site ad hoc): position heuristics (real control syntax is a prefix/suffix phenomenon; quoted syntax is mid-text), code-fence and inline-backtick awareness, and proportion guards (refuse an extraction that would consume most of the response).
<!-- SECTION:DESCRIPTION:END -->
