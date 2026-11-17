---
id: TASK-1443
title: Settings discoverability fixes from the command-tree audit (after beta.246)
status: To Do
assignee: []
created_date: '2026-11-17T20:38:00Z'
labels:
  - area:bot-client
  - size:M
  - state:ready
dependencies: []
priority: medium
ordinal: 1443000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: TASK-1442 audit (report docs/local/command-tree-audit.md, gitignored). Users cannot find where per-character behaviour is set; the Lilith voice case needed Lila to walk a user through it. The dashboards already match admin page for page (shared buildCascadePages), so the fixes are text, cross-links and two display gaps. Lila 11-17 picked: one PR after beta.246, no command renames.

What:
- Descriptions and help text: /character overrides says what it holds (voice replies, memory, context); /voice and /voice view in plain words; drop "extended context" (channel/index.ts:164, SettingsDashboardBuilder.ts:190); "global" only for bot-wide; /character settings says creator-only and applies to everyone; per-dashboard description line in admin style; reword the channel "not included in cascade" note; "Set here" instead of "Override" status; three description-verb mismatches.
- /voice view gains a Voice replies line (resolved mode, source, command that changes it) and a voice-enabled line.
- New /voice replies character: mode: that writes the same per-character tier as the dashboard (Lila 11-17: chosen for discoverability).
- /help autocomplete matches descriptions; getting-started gains a Customize field.
- /character overrides passes the invoking channel to the resolve call so channel-tier values show (confirm the display with Lila on the PR).
- Read-only Model preset line (value, source, command) on the character-overrides and user-defaults dashboards; voice-enabled note on the Voice page.
- docs/commands.md and getting-started: settings-tiers section and a voice-replies row.

Not in scope (Lila 11-17: no renames): command-shape unification and option renames (audit findings 8 and 12); the unified per-character effective-values card (L).

Acceptance: each item above shipped or split out with a reason; a seam test pins the /voice view replies line and the channel id crossing the resolve call.
<!-- SECTION:DESCRIPTION:END -->
