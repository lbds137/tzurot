# Tzurot Privacy Policy

**Status: In effect.**

_Last updated: 2026-07-16_

Tzurot is a Discord bot that lets you talk with AI characters. It is operated by an individual developer ("the operator", "we"). This policy explains what data the bot stores, why, where it goes, and what control you have over it. It is written to describe what the software actually does — nothing more.

## What we collect and store

**Account basics.** Your Discord user ID, username, timezone (if you set one), your notification preferences, and whether you have completed the 18+ verification (a yes/no flag with a timestamp — we never ask for or store your birthdate or identity documents).

**Messages.** The content of messages in conversations the bot participates in, kept so characters can hold a coherent conversation. This includes message text, attachments' AI-generated descriptions, channel and server IDs, and reply context. Please don't share sensitive personal information (health, financial, or identity details) in conversations — the bot never asks for it and does not need it.

**Memories and facts.** The bot builds long-term memory for characters: conversation summaries and short factual statements extracted from what is said (for example, "this user's cat is named Miso"), stored with embeddings for retrieval. These are derived from your messages and are about you.

**Your creations.** Personas and characters you author, including their descriptions, avatar images, and voice-reference audio clips you upload for voice cloning. Avatar images are served from a public URL without authentication — Discord requires this for the bot to display them — so do not use an avatar image you would not want publicly reachable.

**API keys (BYOK).** If you connect your own AI-provider API key, it is encrypted at rest with AES-256-GCM (unique IV per encryption, authenticated tags) and used only to call that provider on your behalf. The same encryption applies to any external session credentials you supply for data imports.

**Usage records.** Per-request logs of provider, model, and token counts — kept to prevent infrastructure abuse, including for users on their own keys. No message content is in these records.

**Feedback.** If you submit feedback via `/feedback`, the submission is stored and a copy is posted to a private channel the operator reads.

**Diagnostic logs.** For 24 hours after each AI response, the bot keeps a "flight recorder" entry containing the full request context — your message, the assembled prompt (including character definition and retrieved memories), and the model's raw output — used to debug generation problems. You can view your own entries with `/inspect`; the operator can view all entries during that window. They are deleted automatically after 24 hours.

## Retention

| Data                          | Kept for                                                                                                                   |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Conversation history          | 30 days (swept daily)                                                                                                      |
| Diagnostic logs               | 24 hours (swept hourly)                                                                                                    |
| Data exports you request      | 24 hours, then deleted                                                                                                     |
| Memories and extracted facts  | Hidden from use the moment you forget them; rows erased with their persona/character (see below)                           |
| Personas, characters, uploads | Until you delete them                                                                                                      |
| Feedback you submit           | Deleted once it is both 90 days old and reviewed by the operator — or when you delete your account                         |
| Release-DM delivery records   | Deleted once 90 days old and settled (the record of your latest notification is kept until it's replaced or you delete it) |
| Account basics, usage records | Until you delete your account (see "Your controls")                                                                        |

## Where your data goes (third parties)

Your conversation content is sent to AI providers to generate responses. Which provider depends on your configuration:

- **OpenRouter** — the primary AI provider (a router across many models). Receives the assembled conversation context (character definition, recent history, retrieved memories, your message, and any images) when it generates a response.
- **z.ai** — an alternative AI provider. Receives the same class of conversation context when it generates a response. Free-tier requests are served by OpenRouter or z.ai depending on operator configuration and available capacity at the time.
- **Mistral / ElevenLabs** — optional voice providers, used only if you connect your own key. Each can provide both transcription (receiving your voice-message audio) and speech synthesis (receiving the character's response text), and both can receive your uploaded voice-reference audio for voice cloning.
- **Self-hosted voice engine** — the default voice pipeline runs on our own infrastructure, not a third party: your voice messages are transcribed and response audio is synthesized there.
- **shapes.inc** — contacted only if you explicitly run an import/export of your own shapes.inc data, using credentials you supply.
- **Railway** — hosts the bot's services and databases. All stored data described above lives there.

Each provider processes data under its own privacy policy. We attach no analytics, telemetry, or advertising services — none exist in the codebase.

We never sell your data.

## AI training

- **Tzurot does not train on your data.** No training or fine-tuning pipeline exists in the codebase; your messages, memories, and creations are used only to generate the responses you ask for.
- **Free tier (the operator's keys).** Requests served on the operator's OpenRouter account are restricted by its privacy settings: endpoints that may train on request data — paid or free — and endpoints that may publish prompts are all disallowed, so OpenRouter will not route your content to a provider that trains on it. Free-tier GLM requests served via z.ai are governed by z.ai's API terms, under which submitted content is not used to develop or improve their services absent explicit agreement (we have given none) and API content is not stored on their servers.
- **Bring-your-own-key.** By connecting your own API key you are expressly directing the bot to send conversation content to that provider under **your** account and its data-usage settings. Configuring those settings — for example, OpenRouter's "may train on request data" toggles — is your responsibility; we do not and cannot control them. Be aware that in shared channels, the conversation context sent through a configured key can include other participants' recent messages — if you bring a key, their words travel under your provider settings too, and if someone else brings one, yours may travel under theirs.

## Your controls

- **Memory**: browse, search, correct, and forget individual memories and facts (`/memory`); batch-delete or purge a character's memories. Honest detail: forgetting removes a memory from use and from view **immediately**, but the underlying row is retained (marked deleted) until it is hard-erased — which happens when you delete the associated persona or character, when you use incognito's retroactive forget, or when you delete your account (`/settings data delete`). **Focus mode** stops memory reads; **incognito mode** stops memory writes for a session, with retroactive (hard-deleting) forget.
- **History**: clear your conversation history (`/history clear` — a soft reset, with undo).
- **Notifications**: release announcements are sent only to accounts that have actually used the bot (a real conversation, a connected key, or an explicit `/notifications` preference — never mere presence in a channel the bot can read), default to breaking-change releases only, and are opt-out (`/notifications disable`, or pick a level).
- **Keys**: remove a connected API key at any time (immediate hard delete).
- **Creations**: delete your personas and characters (deletion cascades to their conversation history and memories).
- **Export everything**: export all data associated with your account in a portable format (`/settings data export`).
- **Delete everything**: permanently erase all data associated with your account, with an explicit confirmation step (`/settings data delete`). You can also contact the operator (see "Contact") to request removal of anything without a self-serve path.

## Age requirement

Tzurot is for adults. Chatting with characters requires confirming you are 18 or older (verification is automatic in Discord age-restricted channels). Do not use the bot if you are under 18.

## Security

Secrets (API keys, credentials) are encrypted at rest as described above. Service-to-service traffic is authenticated. Access to production data is limited to the operator. No system is perfectly secure; use the incognito and memory controls for anything you'd rather not have stored.

## Changes

Material changes to this policy will be announced through the bot's release-notes channel (the same opt-out DM system described above) and reflected in the "last updated" date.

## Contact

Questions or data requests: use the `/feedback` command in Discord, or open an issue at [github.com/lbds137/tzurot/issues](https://github.com/lbds137/tzurot/issues). If you have already deleted your account (or can't use Discord), GitHub issues is the right channel — erasure requests are honored there too.
