---
id: TASK-1451
title: Settings dashboard index follow-ups from the PR 2763 final review
status: To Do
assignee: []
created_date: '2026-11-18T05:20:00Z'
labels:
  - area:bot-client
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1451000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From claude-review round 2 on PR 2763 (TASK-1441, head 9e8ab16cb, no blockers), filed at the review-round step-back.

1. Lost per-command wiring coverage: character/settings.test.ts and character/overrides.test.ts no longer send a `<prefix>::page::<id>::next` customId through handleCharacterSettingsButton / handleCharacterOverridesButton (round 1 replaced those Next presses with jumpTo('context-display')). Add one test per file: jumpTo('memory') then press Next through the command's button export and assert page 2.
2. Latent landing/return mismatch: resolveLandingView (settingsIndexView.ts) sends a 1-page paged config to the overview, but Back/expiry recovery (settingsNavigationHandlers.ts ~109) and the reset flow (settingsResetFlow.ts ~94) send any config with pages.length > 0 to the index. No 1-page config exists today. Route all three through one predicate built on INDEX_LANDING_MIN_PAGES (e.g. hasIndex(config)), with a test for a 1-page config on each path.
3. The four per-file jumpTo test helpers (settings/defaults/edit.test.ts, character/overrides.test.ts, character/settings.test.ts, channel/settings.test.ts) differ only in customId prefix and router; extract one shared test helper.
4. The jumpTo helpers cast `as never`; use `as unknown as StringSelectMenuInteraction`.

Declined from the same review: splitting the combined "opens on the index … and every page renders …" tests. Each follows one user journey (land, then navigate), and the landing alone is already pinned by the threshold and real-config tests, so a split adds no failure localisation.

Acceptance: items 1-4 done, each new test seen red against a mutation.
<!-- SECTION:DESCRIPTION:END -->
