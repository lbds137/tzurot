---
id: TASK-1400
title: >-
  Idea: Claude for selected characters, with an out-of-character refusal check
  before delivery
status: To Do
assignee: []
created_date: '2026-11-10T22:29:00Z'
labels:
  - area:ai-worker
  - size:L
  - state:ready
dependencies: []
priority: medium
ordinal: 1383000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the owner mostly stopped chatting with her characters. The default model (GLM 5.3 Flash) reads samey (see TASK-1346 for one tic), and she rates Claude models highest. Idea relayed by the Chats session on 2026-11-10 at her request; held, not a start order (her 11-04 ruling: loose ends first, no new epics until she says).

What: let Claude serve selected characters (or her own user default) while GLM stays the global default. Two parts:
1. Out-of-character refusal check before delivery. A completion where the model steps out of the character to decline or moralize is a normal 200, so the existing fallback never fires: quotaFallback.ts only reroutes on error categories such as PROVIDER_CONTENT_REFUSED (quotaFallback.ts ~66, ~161-169), and LLMInvoker.ts ~739 reads only a structured `refusal` field. Add a judge (cheap model or phrase match) between generation and send; on an out-of-character refusal, drop the reply and rerun on the fallback model. Her bar: one more in-voice moralizing refusal and the experiment is over.
2. Funding and route. Idea: the monthly Anthropic API credit instead of OpenRouter per-token. UNVERIFIED: whether a plain Console API key draws from that credit, and whether Tzurot reaches Anthropic directly or via OpenRouter with her own key. Route per Lila 2026-11-20: Tzurot calls Anthropic through OpenRouter (BYOK on her Console key, like the Deck's or-claude lane), not a direct Anthropic SDK call. The credit lane belongs to the Deck session; any spend change goes through Deck and her.

Not caught by the check: a reply that stays in voice but plays the character timid. Only she can judge that, per character. A fair test uses the characters she liked talking to most, on current models (the one character she remembers being refused has a premise likely to be declined anyway, so it is weak evidence).

Owner question: Pick up the Claude-for-selected-characters experiment (refusal check first), and when?
Recommendation: after the provenance loose ends close — build the out-of-character refusal check first and measure it on GLM traffic before any Claude spend, so the guard exists before the first Claude reply reaches her.

Acceptance: an out-of-character refusal from the primary model is never delivered; the fallback model answers instead; she has run her chosen characters on Claude and ruled on the result.
Owner ruling (2026-11-20, AUQ): after the attachment-provenance loose ends (TASK-1395 family) close; refusal check first, measured on GLM traffic, before any Claude spend.
Owner ruling (2026-11-20 ~18:50 EST, AUQ via Deck; supersedes the "before any Claude spend" clause above): run a Claude character EVAL FIRST, after the Sun 11-22 week reset. Shape: replay ~20 recent real turns from her favourite characters (Emily included), taken from the diagnostic log (7-day retention, CleanupDiagnosticLogs.ts, so pull them early), on Sonnet 5.5 and Haiku 5.5 with 2-3 system-prompt variants, against GLM 5.3 Flash; she rates them blind (seyag:eval shape: pre-register arms, sample and decision rule). Funded from the $50 Anthropic Console reserve (deck-platform lanes/credit-reserve.toml), est. ~$5 of model calls. Her context: Emily read cold on Anthropic; 11-13 side-by-side (Haiku substituted a milder act despite a permitting prompt and facts in context). Outcome decides whether the refusal check and Claude route get built; a no-go parks this task on evidence.
Eval add-ons (Lila 2026-11-20, via Deck): (1) Thinking: she saw Claude's thinking come through on some turns and not others in her Emily tests, always brief. Per OpenRouter's reasoning docs (openrouter.ai/docs/use-cases/reasoning-tokens), reasoning is returned "if the model decides to output them" and OpenRouter defaults Claude to summarized thinking (thinking.display 'summarized'). Measure the presence rate per arm (memories.thinking_content / the diagnostic row), and record the reasoning params Tzurot actually sends. (2) Privacy: OpenRouter prompt logging is ON on her account (she enabled it for debugging; it is off by default), so eval traffic through OpenRouter is stored by OpenRouter. Record that in the eval's harness conditions. OpenRouter also offers per-request `provider: { zdr: true }` and account-level ZDR scopes.
Eval prep & rulings (2026-11-21): Pulled all 114 owner 7d prod diagnostic logs locally (`docs/local/task-1400-eval/diagnostic-logs-2026-11-21.json`, chmod 600, gitignored), froze the stratified 20-turn sample (`sample-20.json`: 10 Emily across 5 channels, 4 Lilith, 2 Lila Elyona, 2 Sallie May, 2 Charlie Morningstar; 1,268,200 prompt tok, mean 63.4k/turn), and wrote the `seyag:eval` pre-registration (`preregistration.md`). Owner AUQ rulings (2026-11-21): (1) run 4 Claude arms on all 20 turns (V0 baseline + V1 anti-softening x Sonnet 5.5 & Haiku 5.5, ~$10.13 cached / ~$12.26 uncached; add V2 only if V1 shows clear lift); (2) keep OpenRouter account default (prompt logging ON) and record it in the harness conditions. Also observed live: `services/ai-worker/src/utils/reasoningModelUtils.ts` (`CLAUDE_EXTENDED_THINKING`) misses `claude-5.5` (added to TASK-1189), and all 3 live COLD `anthropic/claude-haiku-5.5` logs returned `apiReasoningLength: 0` while 2/3 emitted inline `<think>` tags. Ready to execute after the Sun 2026-11-22 01:00 EST week reset.
<!-- SECTION:DESCRIPTION:END -->
