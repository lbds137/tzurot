# Tzurot Privacy Policy

**Status: In effect.**

_Last updated: 2026-08-26_

Tzurot is a Discord bot that lets you talk with AI characters. It is operated by an individual developer ("the operator", "we"). This policy explains what data the bot stores, why, where it goes, and what control you have over it. It is written to describe what the software actually does — nothing more.

## What we collect and store

**Account basics.** Your Discord user ID, username, timezone (if you set one), your notification preferences, and whether you have completed the 18+ verification (a yes/no flag with a timestamp — we never ask for or store your birthdate or identity documents).

**Messages.** The content of messages in conversations the bot participates in, kept so characters can hold a coherent conversation. This includes message text, attachments' AI-generated descriptions, channel and server IDs, and reply context. Please don't share sensitive personal information (health, financial, or identity details) in conversations — the bot never asks for it and does not need it.

**Server membership details.** For servers where you talk with characters, the bot keeps your last-observed role names, role color, and join date, used to describe conversation participants to the AI consistently between messages. These are deleted with your account.

**Memories and facts.** The bot builds long-term memory for characters: conversation summaries and short factual statements extracted from what is said (for example, "this user's cat is named Miso"), stored with embeddings for retrieval. These are derived from your messages and are about you.

**Your creations.** Personas and characters you author, including their descriptions, avatar images, and voice-reference audio clips you upload for voice cloning. Avatar images are served from a public URL without authentication — Discord requires this for the bot to display them — so do not use an avatar image you would not want publicly reachable.

**API keys (BYOK).** If you connect your own AI-provider API key, it is encrypted at rest with AES-256-GCM (unique IV per encryption, authenticated tags) and used only to call that provider on your behalf. The same encryption applies to any external session credentials you supply for data imports.

**Usage records.** Per-request logs of provider, model, and token counts — kept to prevent infrastructure abuse, including for users on their own keys. Each record also notes which of your characters it was for; AI-generation records additionally note how long the request took and whether it ran on your own API key or on the free tier. No message content is in these records.

**Command telemetry.** One record per command you run: the command's name, whether it succeeded (and an error code if not), how long it took, the server and channel-kind (server/DM/thread) it ran in, and a few coarse technical tags (model family, provider, voice mode). No message content is ever in these records. Kept 12 months, included in your data export, and removed by account erasure.

**Feedback.** If you submit feedback via `/feedback`, the submission is stored and a copy is posted to a private channel the operator reads.

**Diagnostic logs.** For 7 days after each AI response, the bot keeps a "flight recorder" entry containing the full request context — your message, the assembled prompt (including character definition and retrieved memories), and the model's raw output — used to debug generation problems. You can view your own entries with `/inspect`; the operator can view all entries during that window. They are deleted automatically after 7 days.

## Retention

| Data                          | Kept for                                                                                                                   |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Conversation history          | 30 days (swept daily)                                                                                                      |
| Diagnostic logs               | 7 days (swept hourly)                                                                                                      |
| Data exports you request      | 24 hours, then deleted                                                                                                     |
| Memories and extracted facts  | Hidden from use the moment you forget them; rows erased with their persona/character (see below)                           |
| Personas, characters, uploads | Until you delete them                                                                                                      |
| Feedback you submit           | Deleted once it is both 90 days old and reviewed by the operator — or when you delete your account                         |
| Release-DM delivery records   | Deleted once 90 days old and settled (the record of your latest notification is kept until it's replaced or you delete it) |
| Command telemetry             | 12 months (swept daily)                                                                                                    |
| Account basics, usage records | Until you delete your account (see "Your controls"), or until the inactivity rule below applies                            |

### Inactive accounts

We are not a commercial service that keeps your data forever on the chance you
come back. If **you have not used the bot for at least 180 days**, your account
enters the retention process, and which path it takes depends on whether we can
still reach you:

- **If we can reach you**, we first send you a DM naming a concrete deletion
  date **at least 30 days away**. Using the bot once — any command or chat
  message — resets your inactivity clock entirely and cancels the deletion.
  The notice also points you at `/settings data export` (take a full copy of
  your data) and `/settings data delete` (delete immediately instead of
  waiting). Only if the 30 days pass with no activity may your account and
  everything associated with it be erased.
- **If we cannot reach you** — you have closed DMs and share no server with
  the bot, so a notification cannot be delivered; or your Discord account no
  longer exists — your account may be erased without the notice, because there
  is no way to deliver one.

Inactivity alone never erases an account you actually used while you are
reachable: the notice and its grace period always come first. Any activity
resets your inactivity clock; a notification that successfully reaches you
resets the unreachability state.

One narrow exception to the notice: accounts with no sign of direct use. If
your row shows no trace of actually using the bot — no conversations with its
characters, no characters or personas you created, no keys or notification
settings you configured — it holds nothing you made, and it is removed without notice once
inactive. Such rows usually exist only because you spoke in a channel the bot
could see. There is nothing to export, and a deletion notice from a bot you
never really used would be noise, not information.

Erasure is complete — everything `/settings data delete` removes, this removes.
It differs from that self-serve deletion in exactly one way, and the difference
protects other people rather than you: a character you created that **other
users have talked to** is not deleted here, because deleting it would erase
their conversations and memories too. Such a character is transferred to a
holding account instead, and keeps a record of who created it so it can be
returned if you come back.

**This exception applies only to the inactivity rule.** If you delete your own
account with `/settings data delete`, the characters you created are deleted
outright — shared or not. The command warns you how many other people have
memories with each one before you confirm.

We keep a record that an erasure happened (your Discord ID, the date, and how
many rows were removed) so we can answer questions about it. That record
contains no message content, memories, or character definitions.

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

- **Memory**: browse, search, correct, and forget individual memories and facts (`/memory`); batch-delete or purge a character's memories. Honest detail: forgetting removes a memory from use and from view **immediately**, but the underlying row is retained (marked deleted) until it is hard-erased — which happens when you delete the associated persona or character, when you use incognito's retroactive forget, or when you delete your account (`/settings data delete`). **Fresh mode** stops memory reads for a session; **incognito mode** stops memory writes for a session, with retroactive (hard-deleting) forget.
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
