---
id: TASK-1192
title: >-
  Model-footer link gap: bare URLs in free-text model ids render live (modelUsed
  class)
status: To Do
assignee: []
created_date: '2026-10-08 16:54'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1182000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: claude-review round 2 on PR #2583 confirmed the mechanism with a test — stripMarkdownDelimiters (strips [ ] ( ) < > only) leaves a bare URL intact, and Discord auto-links it. A personality owner controls the model field (modal free-text, length-only validation), so a disguised link can render clickable to guests.

Fixed in #2583 for the piggyback-note field (toInertCodeSpan code span, owner ruling 2026-10-08). NOT fixed: modelUsed, which rides inside a real [model](url) markdown link where a code span does not fit — the same sanitization gap, pre-existing, reachable from a second field.

What: choose a neutralization for the modelUsed segment after reading where model ids originate (settings modal free text, length-only validation; provider ids are ASCII slugs). Candidates: strip URL-bearing characters beyond the delimiter strip, validate the shape (allow only chars legal in a model id), or render the label segment through a code span and build the link ourselves from a validated id.

Acceptance: a hostile model id cannot render any link our own code did not construct, pinned by a test in discord.test.ts; the legit provider-id path renders unchanged.

Provenance: filed per owner ruling 2026-10-08 (via Deck) during PR #2583 review round 2; priority medium because the trust boundary is personality owners, not strangers.
<!-- SECTION:DESCRIPTION:END -->
