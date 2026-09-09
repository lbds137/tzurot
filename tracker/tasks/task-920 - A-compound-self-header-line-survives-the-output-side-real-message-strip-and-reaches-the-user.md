---
id: TASK-920
title: >-
  A compound self-header line survives the output-side real-message strip and
  reaches the user
status: To Do
assignee: []
created_date: '2026-09-09 15:10'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 918000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: a flash-tier model stamped a fake header line onto its own reply and it reached Discord, prod, real-messages flag ON. Runtime-confirmed by running the shipped dist functions against the leaked string: the reproduction removed exactly 12 chars, matching the count recorded in the owner debug payload.

Two independent gaps. First, leadingHeaderLineMatcher (services/ai-worker/src/services/context/RealMessagesBuilder.ts, grep leadingHeaderLineMatcher) anchors the header shape at the START of the string and its inner group is bracket-free by construction, so a compound leading line of the form bracket-junk, italic annotation, real header does not match at all. Positive control: the canonical single header strips clean and logs headerLinesStripped 1.

Second, the generic step in buildArtifactPatterns (services/ai-worker/src/utils/responseArtifacts.ts, grep Standalone timestamp) then matched the leading bracket group lazily and removed only the FIRST one, degrading a recognizable header line into unrecognizable debris that shipped to the user. It also consumed the evidence: headerLinesStripped logged 0, so the telemetry that exists to count this class reported nothing.

The prompt side is already correct. The S0 output_constraints section carries an explicit never emit that bracket-header form yourself; the model ignored it, which is exactly the case the output-side strip exists to cover.

Fix shape: add a self-header line matcher scoped to the personality name into stripRealMessageEchoArtifacts, which already runs before the generic pass. First line only, at most about 120 chars of preamble, ending in an open-bracket, the personality name, the em-dash separator, a timestamp, close-bracket, consuming the trailing newline. Name scoping is load-bearing rather than cosmetic: the any-name variant destroys a legitimate line that quotes another speaker header mid-sentence. Increment headerLinesStripped so the shape becomes visible in telemetry.

Acceptance: the exact leaked compound prefix strips to the reply body; six keep-cases stay byte-identical (stage direction, prose with an em-dash, a leading non-header bracket aside, a header on a later line, a quoted other-speaker header on line one, a reply opening with italics); headerLinesStripped increments for the compound shape; canary by deleting the new matcher and confirming the new test reddens.
<!-- SECTION:DESCRIPTION:END -->
