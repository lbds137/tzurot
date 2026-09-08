---
id: doc-80
title: 'Idea: Message-content-in-logs sweep — one pass across every service'
type: other
created_date: '2026-08-21 04:21'
---


_Focus: `00-critical.md` says NEVER log message content. Four tasks already record separate instances of it. Do one sweep instead of four._

## Why this is a batch, not another task

The class kept getting filed one site at a time, because each instance is found while doing something else. Filed as a batch so the next find joins it rather than becoming a fifth fragment. Members below are the known instances; the pass is the deliverable.

`00-critical.md` § Logging (No PII): "NEVER log: Emails, phones, IPs, usernames, message content, API keys. Safe to log: User IDs, guild IDs, channel IDs, timestamps, error codes."

## Known members

- **TASK-593** — message and LLM-response content logged as previews across ~12 ai-worker sites. The largest single member.
- **TASK-422** — CrossTurnDetection logs message content on every passed check.
- **TASK-533** — persona bio text logged as `contentPreview` at debug level.
- **TASK-594** — the `NODE_ENV` schema default is `development`, so a PII-gated dev-only log path fails OPEN. This one is the multiplier: it decides whether the other members leak in prod at all, so establish its answer BEFORE sizing the rest.
- **bot-client `ReferenceFormatter.ts:142`** — `logger.debug({ snapshotContent: snapshot.content?.substring(0, 50) }, 'Added snapshot from forwarded message')`. Found 2026-08-21 during the TASK-708 behavior sweep (PR 2168); not separately filed, because this doc is where it belongs.

## Shape of the pass, when it runs

Enumerate deterministically rather than by memory — the reason this class fragmented is that every find so far was incidental. A grep for `content` inside logger calls is the starting point but under-matches: the field is variously named `content`, `contentPreview`, `snapshotContent`, `preview`, and `text`, and truncation (`.substring(0, N)`) is the common disguise. Positive-control any pattern against the five members above before trusting an empty result on some service.

Then decide the disposition per site rather than blanket-deleting: a length (`contentLength: x.length`) is safe and often preserves the diagnostic value the preview was reaching for — `services/bot-client/src/commands/memory/detail.ts:403` already does exactly that and is the shape to copy.

## Not in scope

`interaction.reply({ content: ... })` and similar OUTBOUND payloads are not logging — a `content` field on a Discord send is the message itself, not a log of one. A naive grep hits dozens of these; they are the noise this section exists to pre-empt.

## Owner decision (2026-09-08)

The pass runs as ONE local-only opt-in flag, `LOG_CONTENT_PREVIEWS` (mirroring `LOG_PROMPT_ASSEMBLY` from TASK-594: development `NODE_ENV` AND the flag), behind a shared `contentPreview(text, maxChars)` helper in common-types that returns `undefined` when off, so the field is absent from deployed logs by default. Lengths stay always-on at every site; a content digest replaces the preview where the site diagnoses duplication (cross-turn NEAR_MISS, duplicate-detection). The owner accepted that prod NEAR_MISS lines keep only their metrics. Per-site stripping and a prod carve-out for NEAR_MISS snippets were the rejected options. TASK-594 shipped as the multiplier (#2371); TASK-422/533 were already shipped; the remaining members (TASK-593 and the bot-client snapshot preview) are one dispatch.
