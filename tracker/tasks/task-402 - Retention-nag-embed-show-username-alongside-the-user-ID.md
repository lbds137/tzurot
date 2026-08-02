---
id: TASK-402
title: 'Retention nag embed: show @username alongside the user ID'
status: To Do
assignee: []
created_date: '2026-08-02 21:44'
updated_date: '2026-08-02 21:44'
labels:
  - 'area:bot-client'
  - 'size:S'
dependencies: []
priority: medium
ordinal: 402000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the owner reads the daily "Accounts eligible for retention purge" embed on a phone; raw snowflakes are unreadable (owner ask 2026-08-02, screenshot of the dev nag).
What: thread users.username through the retention preview payload (gateway GET /internal/retention/preview -> RetentionNagScheduler) and render each line with THREE identity tokens (owner-refined 2026-08-02): <@id> mention (clickable profile on desktop - the only path to a profile at all), plain-text @username from the DB column (the readable identity on mobile, immune to client resolution), and the existing `id` pill (copy-paste into retention:purge). ~10 lines x ~110 chars sits well inside the 4096 embed-description cap.
Owner observation 2026-08-02: <@id> embed mentions DO tend to render on desktop but NOT on mobile (plausible: desktop lazily fetches unknown profiles, mobile resolves from cache only - unverified). Owner reads this embed on mobile, so plain-text username stands.
Acceptance: nag + retention:preview CLI both show @username; a user with an empty/stale username still renders the ID line without crashing.
<!-- SECTION:DESCRIPTION:END -->
