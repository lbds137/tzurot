---
id: TASK-802
title: Sweep bare escapeMarkdown call sites — defaults do not neutralize masked links
status: To Do
assignee: []
created_date: '2026-08-28 23:12'
labels:
  - 'area:bot-client'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 802000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PROBED against the installed discord.js, not assumed. escapeMarkdown with default options leaves masked-link syntax completely untouched:
  escapeMarkdown("[Free Nitro](http://evil.example)") returns the input unchanged
  escapeMarkdown("<@everyone>") returns the input unchanged
Only the { maskedLink: true } option escapes the opening bracket, which is what makes the string render as literal text instead of a live clickable link.

So every site that escapes a user-authored string with bare escapeMarkdown and renders it into Discord-parsed text still admits a masked link. There are 111 bare escapeMarkdown call sites in services/bot-client/src outside tests (grep for escapeMarkdown( minus maskedLink). Not all are user-authored input and not all render into a link-parsing surface, so the count is the search space, not the defect count.

Fixed already, do not re-do: the Personality field in observability/ErrorChannelReporter.ts, via a local escapePersonaName using { maskedLink: true }.

Why escape rather than strip: persona names legitimately contain parentheses. Verified escapeMarkdown("Lilith (v2)", { maskedLink: true }) returns it unchanged, while stripMarkdownDelimiters would mangle it. Use the strip only for values where delimiters are never legitimate (model and provider ids).

What: classify the 111 sites — is the value user-authored, and does the surface parse markdown — then apply { maskedLink: true } to the ones that are both. Personality names are the widest exposure since any user can set one via /character create and Personality.name is VarChar(255) with no character restriction (prisma/schema.prisma:430).

Related: TASK-800 covers the /inspect embed, which needs the strip treatment rather than this one because its exposed values are model and provider.

ENUMERATION GAP — the search space above is too narrow (found 2026-08-30 while reviewing the deny UX PR). "111 bare escapeMarkdown call sites" comes from grepping for escapeMarkdown( minus maskedLink, so it structurally cannot find a site that applies NO escaping at all — and that site is strictly worse than a bare-escapeMarkdown one, since bare escaping at least neutralizes the other delimiters. Confirmed instance: services/bot-client/src/commands/deny/detailTypes.ts renders entry.reason raw in the Reason field, while services/bot-client/src/commands/deny/browse.ts wraps the SAME field in escapeMarkdown for its metadata line — one field, two treatments, in one command family. Low severity on its own (reason is authored by whoever ran /deny add, which requires moderator permissions, so it is not open to arbitrary users) but it is evidence the method misses a whole class.

When this sweep runs, widen the enumeration to BOTH shapes: sites that escape insufficiently AND sites that do not escape at all. The second needs a different search — enumerate the values interpolated into embed fields and ask which are externally authored, rather than grepping for the helper. TASK-704 does not cover it either; that one is about unclamped length, not escaping.

Acceptance: the classification is in the closing PR body, every user-authored site rendering into a parsing surface passes maskedLink, and one test pins a masked-link input rendering inert at a representative site.
<!-- SECTION:DESCRIPTION:END -->
