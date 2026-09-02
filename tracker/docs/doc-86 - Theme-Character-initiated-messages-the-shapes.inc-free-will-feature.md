---
id: doc-86
title: 'Theme: Character-initiated messages (the shapes.inc "free will" feature)'
type: other
created_date: '2026-08-30 21:11'
---

_Focus: let a character start a conversation on its own — the thing shapes.inc called "free will" — with consent, cost, and cadence all deliberately bounded._

## Provenance

**Direct user request, 2026-08-30**, in a server channel: _"is there a way to set up characters so they will text you randomly automatically of their own accord? like so they initiate a conversation"_ — followed by _"hell yea pls can u let me know when it's available"_ once the owner said it was something to look into. The owner named the prior art in the same exchange: it was called **"free will"** when shapes.inc was live, which is the vocabulary users will bring.

**⚠️ OPEN PROMISE TO A USER**: the owner answered _"will do"_ to being told when it ships. That is a commitment to a named person, not a generic backlog item — whoever ships Phase 1 should surface that so the owner can follow through.

## Why this was invisible until now

The concept IS written down — as **`docs/reference/architecture/ARCHITECTURE_DECISIONS.md` § 7, "Personality 'Free Will' System"** — and that is exactly why nobody could find it. That file is a **2025-10-02 Gemini planning artifact** whose own header says: _"Status: Historical planning artifact. Several decisions here were superseded during implementation."_ It is not a work queue, nothing schedules from it, and it does not appear in `tracker/`, `cold/queue.md`, or `now.md`.

**Do not build § 7's design.** It specifies a LangGraph multi-agent pipeline (Triage Node → Context Gathering → Speaker Selection → Governance Check → Invocation), and the same header records that the shipped stack has **no graph-orchestration layer**. Read it for the QUESTIONS it asks — triage cost, speaker selection, governance, who pays — not for its mechanism. Its one genuinely reusable idea is the split cost model (orchestrator on the owner's key because observation is the owner's cost; executor on the end user's key because the conversation is theirs), and even that is a proposal, not a decision.

Closest live neighbour: **doc-11 § Agentic Features**, whose self-directed list (tool use, Dream Sequences, Relationship Graphs) is about what a character does *within* a turn it was already invoked for. This theme is the missing sibling: what makes a turn happen with no user message at all. Also adjacent: **doc-54** (Diegetic Discord events) treats platform events as stimuli — a different trigger source for the same "something happened, should a character speak?" question.

## The design questions, none of them settled

1. **Consent, and its granularity.** An unprompted DM is a materially different product from a character piping up in a channel it is already active in. Per-user opt-in is the floor; per-character and per-channel are open. Default must be OFF.
2. **Cadence and quiet hours.** "Randomly" is the user's word, not a spec. Frequency ceiling, per-user cooldown, timezone-aware quiet hours, and a hard cap on unanswered initiations before backing off (a character that keeps texting into silence is the failure mode that gets a bot muted or kicked).
3. **Who pays.** A proactive turn spends tokens nobody asked for. Free-tier users, guest mode, and BYOK holders each need an answer, and "the owner's key funds observation" scales with user count in a way worth measuring before committing.
4. **What triggers it.** Timer-only is the cheapest v1 and the least interesting. Alternatives: channel activity the character could react to, an unfinished thread, a memory-derived callback ("you said your interview was today"). Each is a different cost and a different creepiness profile.
5. **Where it is allowed to speak.** DM vs activated channel vs both. Channel activation, the denylist, and moderator-facing controls (doc-75) all have to gate it — a proactive message is exactly what a channel allowlist exists to prevent.

## Substrate that already exists (verified, cite before relying)

- **Scheduling**: BullMQ repeatable jobs are the sanctioned recurring-work mechanism (`04-discord.md` § Timer Patterns — `setInterval` is a named scaling blocker). A cadence scheduler does not need new infrastructure.
- **Deliverability**: `users.dmUndeliverableSince` (`prisma/schema.prisma:77`) already tracks users whose DMs bounce, with a stronger-signal sibling documented beside it. Proactive DMs must respect it or they will hammer closed DMs.
- **Activity signal**: `users.lastActiveAt` (`prisma/schema.prisma:67`) exists and is maintained on a cache-miss stamp — a plausible input to "is this person around?" Note it is written via raw SQL specifically to avoid bumping `updated_at` on a sync-tracked table (`03-database.md` § Sync-Tracked Tables); a new proactive-cadence column would face the same constraint.

## Phasing (rough — Phase 0 is the real deliverable)

### Phase 0 — decide the product before any code

Owner answers questions 1–5 above, at least for a v1 slice. The narrowest defensible v1 is probably: **opt-in per user, DM-only, timer-driven with a low ceiling and quiet hours, on the user's own key.** That is a guess, not a recommendation — it is here to be argued with. Council pass before plan-mode.

### Phase 1 — the narrowest shippable slice

Whatever Phase 0 lands on, plus: an opt-in surface, a cadence scheduler on repeatable jobs, deliverability + denylist + activation gating, and an off switch the user can reach in one command.

### Phase 2+ — trigger sophistication

Activity-derived and memory-derived triggers, channel behaviour, per-character personality in initiation style. Explicitly deferred: anything resembling § 7's speaker-selection layer, which presumes a multi-character arbitration problem this project does not have yet.

## Deliberately not in scope

Dream Sequences and Relationship Graphs (doc-11's own entries) — they are self-directed *processing*, not self-directed *speech*, and folding them in would make this theme unschedulable.

## Owner call (2026-09-02): research prior art before Phase 0

Phase 0 is an open-ended design question with many defensible shapes, so the owner does not want to answer the five questions cold. **First deliverable is a prior-art research pass**, distilled to `docs/research/` (public audience — no user content):

- shapes.inc "free will": closed source, so the signals are user discussions online and official documents or blog posts that hint at the mechanism (trigger model, cadence, consent, who pays).
- Any other provider with a comparable character-initiated-messaging concept, and how each answers the five questions.
- The framing question the owner raised: whether this belongs under doc-11's agentic features. Working distinction — agentic features change what a character does INSIDE a turn it was invoked for; this theme is what makes a turn happen with no user message at all. They share the spend/telemetry gate (doc-12), which is why both sit in Phase C.

Phase 0 decisions follow the research, when the time comes. The Phase C build gate (doc-75 + doc-12) is unchanged.
