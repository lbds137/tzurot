---
id: TASK-1212
title: >-
  Cloud units run without the 9 retired guards unless the VM loads the seyag
  plugin
status: To Do
assignee: []
created_date: '2026-10-11 18:16'
updated_date: '2026-10-19 09:52'
labels:
  - 'area:hooks'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1201000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: #2604 retired 8 Tzurot hook copies in favour of their Seyag plugin twins (dispatch-posture-gate, turn-end-shape-gate, promise-ledger-check, blocking-question-channel-check, bare-token-binding-reminder, queued-message-receipt, context-size-reminder, grep-escaped-dollar-guard). The plugin is enabled only in the Deck user settings (~/.claude/settings.json enabledPlugins seyag@lbds137, directory marketplace). A cloud VM (claude --cloud, /tzurot-orchestration Cloud dispatch) clones the repo and reads only the project .claude/settings.json, so on the evidence available it now runs none of the 8; the project copies used to run there. Not verified whether a cloud session inherits user plugins.

What: probe it first (a cloud unit runs a 7-line inline src Edit and reports whether dispatch-posture-gate blocked it). If the plugin is absent, either declare seyag in the project settings (enabledPlugins + extraKnownMarketplaces with the public GitHub source, checking the name clash with the Deck directory marketplace) or accept the gap and keep the cloud spec carrying the rules in prose (it already does for the dispatch rule).

Acceptance: a recorded probe result, and either the plugin loads in cloud VMs or the orchestration skill states which guards cloud units lack.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-10-19: PR 2637 (TASK-1106 part 2) retired a ninth twin, lossy-pipe-guard (rule 1: filtered git commit/push; rule 2: truncated gh reads, with the gh: wrappers in SYG_LOSSY_PIPE_GH_WRAPPERS in project settings). It now runs only where the plugin loads, so it joins the list above, and the acceptance statement of which guards cloud units lack must include it. CI also no longer exercises it (its CI unit test and probe went with the hook).
<!-- SECTION:NOTES:END -->
