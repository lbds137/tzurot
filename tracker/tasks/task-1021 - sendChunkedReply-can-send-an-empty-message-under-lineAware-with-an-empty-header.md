---
id: TASK-1021
title: >-
  sendChunkedReply can send an empty message under lineAware with an empty
  header
status: To Do
assignee: []
created_date: '2026-09-18 22:21'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 1017000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: claude-review finding on PR #2453 (low, non-blocking), verified unreachable for both shipped callers. splitMessageByLines can emit an empty chunk — a blank source line landing alone at a forced boundary — and its own docstring delegates the remedy to the caller: "callers that cannot transmit an empty string filter at their own boundary rather than having this drop the line." sendChunkedReply does not filter. With header set to the empty string (both db-sync call sites use it), an empty first chunk reaches interaction.editReply with empty content, no embeds and no components, which the Discord API rejects. Per the module delivery contract a FIRST-chunk failure is not swallowed, so it propagates to the caller.

Reachability today: needs content whose very first source line is blank followed immediately by a line long enough to force a flush before any non-blank content accumulates. buildSyncReportText always opens with a heading line, so neither current lineAware caller can reach it. The risk is that lineAware is a general reusable option on a shared utility and the next adopter inherits the trap.

Fix shape: filter out any rendered message that would be empty at the sendChunkedReply boundary, which is where the splitter contract says it belongs; a filter is a no-op for the default splitMessage path, which already drops empty chunks. Handle the degenerate case where filtering leaves nothing to send rather than indexing into an empty array. The filter must be GENERAL rather than first-chunk-specific (claude-review round 2 on PR #2453): a would-be-empty NON-first chunk is unreachable today only because continuedHeader happens to be non-empty at both call sites, so a first-chunk-only guard reopens the same class for any future caller that passes an empty continuedHeader. Also restore the fuller caveat to the lineAware docblock — PR #2453 corrected the now-false claim that fence straddling was the only cost, but left the empty-chunk case named rather than explained.

Acceptance: content whose first line is blank followed by an over-cap line, sent with an empty header and lineAware true, delivers without throwing and loses no non-blank content; a test pins it and reddens when the filter is removed.
<!-- SECTION:DESCRIPTION:END -->
