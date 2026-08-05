# BYOK Manual Testing Guide

A manual test pass for **BYOK** (Bring Your Own Key): storing your own provider
API keys, what changes once a key is present, and what happens when it is
removed. Every step is executable from a phone — a slash command plus the exact
thing you should see.

**How to report**: one line per step — `B.3 pass` / `B.3 fail: <what you saw>`.
A screenshot is only needed where a step says so. Steps are grouped into passes;
each pass states what it uniquely proves, so you can skip a pass whose property
you already trust.

---

## 0. Before you start

### 0.1 What has to be configured

| Variable                          | Services                                 | Why                                                                   |
| --------------------------------- | ---------------------------------------- | --------------------------------------------------------------------- |
| `API_KEY_ENCRYPTION_KEY`          | `api-gateway`, `ai-worker`               | AES-256-GCM key for encrypting stored keys. Unset ⇒ BYOK is disabled. |
| `API_KEY_ENCRYPTION_KEY_PREVIOUS` | `api-gateway`, `ai-worker`               | Only set during a staged key rotation (dual-key window).              |
| `OPENROUTER_API_KEY`              | `ai-worker`                              | The system fallback key. Unset ⇒ users with no key get no response.   |
| `INTERNAL_SERVICE_SECRET`         | `api-gateway`, `bot-client`, `ai-worker` | Service-to-service auth for owner/admin routes.                       |

Verify they are present (values are never printed):

```bash
railway variables --service api-gateway | grep -E 'API_KEY_ENCRYPTION|INTERNAL_SERVICE_SECRET'
railway variables --service ai-worker   | grep -E 'API_KEY_ENCRYPTION|OPENROUTER_API_KEY|INTERNAL_SERVICE_SECRET'
railway variables --service bot-client  | grep INTERNAL_SERVICE_SECRET
```

`ApiKeyResolver` logs `API_KEY_ENCRYPTION_KEY not set - BYOK disabled, using system keys only`
at ai-worker startup when the encryption key is missing — grep for that line if
every key you store appears to be ignored.

> **Never rotate `API_KEY_ENCRYPTION_KEY` by hand-editing the variable.** Rows
> encrypted under the old key become unreadable. Use the staged rotation:
> `pnpm ops secrets:rotate-byok --env <env> --stage 1|2|3` (stage → re-encrypt →
> finalize).

### 0.2 State that can make a test falsely pass

Read this once; the passes below refer back to it.

| Masking state                 | Effect                                                                                                    | Reset                                                          |
| ----------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| **Wallet write rate limit**   | `set` / `test` / `remove` share **10 operations per 15 minutes** per user. Exhausting it returns a 429.   | Wait. There is no bypass — budget your steps.                  |
| **ai-worker key cache**       | Resolved keys are cached **10 seconds** per (user, provider), with Redis pub/sub invalidation on change.  | Wait ~10s, or rely on the invalidation (Pass F tests it).      |
| **`/models browse` cache**    | Your key providers and the global-preset model set are cached **30 seconds** in bot-client.               | Wait 30s before re-checking a usability badge.                 |
| **`showModelFooter`**         | Defaults to `true`. If you turned it off in `/settings defaults edit`, the `Model:` footer never renders. | Re-enable it — several steps read that footer.                 |
| **Existing keys**             | Guest-mode observables only appear when you have **no active key for any provider**.                      | `/settings apikey browse` first; Pass A assumes an empty list. |
| **Existing presets/defaults** | A leftover default preset or per-character override changes which model answers.                          | `/preset default clear` and `/preset override browse`.         |

### 0.3 Providers

`/settings apikey` accepts four providers (the `provider` option is a fixed choice list):

| Choice label              | Value        | Key format check at submit | Validated against the provider before storage |
| ------------------------- | ------------ | -------------------------- | --------------------------------------------- |
| OpenRouter                | `openrouter` | must start with `sk-or-`   | yes                                           |
| ElevenLabs (Voice)        | `elevenlabs` | none (any non-empty key)   | yes                                           |
| Z.AI Coding Plan          | `zai-coding` | none                       | yes                                           |
| Mistral (Voxtral TTS/STT) | `mistral`    | none                       | yes                                           |

Only OpenRouter and ElevenLabs report a remaining balance; the other two show no
credit field.

**OpenRouter is the primary LLM provider.** The voice providers (ElevenLabs,
Mistral) do not take you out of chat guest-mode anywhere — not in the preset UI,
not at generation time; their keys authorize voice endpoints only.
The one exception is **Z.AI Coding Plan**: when the resolved preset's model is a
`z-ai/<model>` on the coding-plan catalog AND you hold a zai-coding key, the
request auto-promotes to direct z.ai routing and is **not** guest mode — no
OpenRouter key required. See the voice-keys note at the end of Pass E for how
this plays out across the UI and the generation path.

### 0.4 The command surface under test

| Area                    | Commands                                                              |
| ----------------------- | --------------------------------------------------------------------- |
| API keys (BYOK)         | `/settings apikey set` `browse` `remove` `test`                       |
| Model presets           | `/preset browse` `create` `edit` `export` `import` `template`         |
| Your default preset     | `/preset default set` `/preset default clear`                         |
| Per-character overrides | `/preset override browse` `set` `clear`                               |
| Model catalog           | `/models browse` `/models view`                                       |
| Owner-only              | `/preset global default` `/preset global free-default` `/admin usage` |

### 0.5 How a preset is chosen for a response

First match wins:

1. Your per-character override — `/preset override set`
2. Your default preset — `/preset default set`
3. The character's own preset
4. The system default preset — `/preset global default` (owner)

**Guest mode cuts across all four.** With no chat-capable key of your own (a
voice-only ElevenLabs/Mistral key does not count — see §0.3), the ai-worker
substitutes a free model whenever the resolved preset is not free —
resolution continues down the guest ladder (your free selection → the free-tier
default set by `/preset global free-default` → the `openrouter/free` router as a
last resort). You do not get an error; you get a different model.

Presets are scoped: **global** presets (owner-created, visible to everyone) and
**your own** presets (`/preset create`, visible only to you).

Each preset assignment targets a **slot** — `Chat` (default) or `Vision`. Every
`default set` / `default clear` / `override set` / `override clear` /
`global default` command takes an optional `slot` option. A `clear` with **no**
slot clears **both** slots.

---

## Pass A — Guest baseline (no key stored)

**Proves**: what the bot looks like before BYOK, so every later change is
attributable to the key.

**Setup**: `/settings apikey browse` must be empty. If it is not, run Pass F
first and come back.

| Step | Action                                                            | Expected                                                                                                                                                                                             |
| ---- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A.1  | `/settings apikey browse`                                         | Ephemeral embed titled **API Keys**, body: “You have no API keys configured yet (BYOK = Bring Your Own Key). Add one with `/settings apikey set` …”. No 💡 Management Commands field.                |
| A.2  | `/preset browse`                                                  | Preamble line: “⚠️ **Guest Mode** - Limited to free models (🆓). Use `/settings apikey set` for full access.” Paid presets render ~~struck through~~; free ones carry 🆓.                            |
| A.3  | `/models browse`                                                  | Free models carry 🆓; paid models carry 🔑 (needs a key). If you instead see ❔ on everything plus “Couldn't verify your API keys right now”, the wallet read failed — retry, don't record a result. |
| A.4  | `/models view` on a paid model (e.g. an Anthropic one)            | Card status line: “🔑 **Needs an OpenRouter key** — add one with `/settings apikey set`”, and the **Access** field reads `OpenRouter key`.                                                           |
| A.5  | Message a character (`@character hi`, any channel)                | It responds. Footer carries **two** lines: `Model: …` and `🆓 Using free model (no API key required)`.                                                                                               |
| A.6  | `/preset override set` → focus the `preset` option                | The autocomplete list ends with an entry **✨ Unlock All Models…** (`/preset default set` shares this autocomplete — either command proves it).                                                      |
| A.7  | Pick **✨ Unlock All Models…** and submit                         | Embed **✨ Unlock All Models** explaining Guest Mode and the three-step key setup. Nothing is written.                                                                                               |
| A.8  | `/preset override set` character:`<any>` preset:`<a paid preset>` | Embed **❌ Premium Model Not Available** naming the preset, telling you to use `/settings apikey set`. The override is **not** set.                                                                  |

_Screenshot A.5 — the two footer lines are the guest-mode signature and the
cheapest evidence for the rest of the pass._

---

## Pass B — Storing a key

**Proves**: the modal path, provider-side validation before storage, and that
the key itself is never echoed back.

**Rate-limit budget**: B.2 + B.5 = 2 of your 10 writes per 15 minutes.

| Step | Action                                                                               | Expected                                                                                                                                                                                                                                                             |
| ---- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B.1  | `/settings apikey set` provider:**OpenRouter**                                       | A modal titled **Set OpenRouter API Key** with one short (single-line) field, placeholder `sk-or-v1-xxxx...`, and the hint “Get a key: https://openrouter.ai/keys”.                                                                                                  |
| B.2  | Submit a **valid** OpenRouter key                                                    | Ephemeral embed **✅ API Key Configured** with a 🔐 Security field (“encrypted at rest and never visible in logs”), a 💡 Next Steps field (“Your API key will now be used for AI responses.”), footer “Use /settings apikey browse to see all configured providers”. |
| B.3  | `/settings apikey browse`                                                            | One row: ✅ badge, name **OpenRouter**, the slug `openrouter`, and `Active · Last used … · Added …`. Plus a **💡 Management Commands** field listing set/test/remove. **The key itself is never shown, masked or otherwise.**                                        |
| B.4  | `/settings apikey test` provider:**OpenRouter**                                      | Embed **✅ API Key Valid**, a **💰 Credit Balance** field (`$` + 4 decimals) if OpenRouter reports one, and a **🚀 Ready to Use** field.                                                                                                                             |
| B.5  | `/settings apikey set` provider:**OpenRouter** again, with a **different** valid key | Same ✅ API Key Configured embed. `/settings apikey browse` still shows exactly **one** OpenRouter row — set overwrites, it never duplicates.                                                                                                                        |

---

## Pass C — What the key changes

**Proves**: the stored key actually widens access, at every surface that reads it.
No writes, so no rate-limit cost.

**Masking state**: `/models browse` caches your key providers for 30 s. If you
run C.1 within seconds of B.2, wait and re-run before recording a failure.

| Step | Action                                         | Expected                                                                                                                                                                           |
| ---- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C.1  | `/models browse`                               | Previously-🔑 paid models now carry ✅. Free models keep 🆓.                                                                                                                       |
| C.2  | `/models view` on the same paid model as A.4   | Status line is now “✅ **You can use this**” and **Access** reads `Ready`.                                                                                                         |
| C.3  | `/preset browse`                               | The ⚠️ Guest Mode preamble is **gone**; no preset is struck through.                                                                                                               |
| C.4  | `/preset override set` → focus `preset`        | **✨ Unlock All Models…** is no longer offered.                                                                                                                                    |
| C.5  | Message a character again                      | Footer has the `Model: …` line **only** — the `🆓 Using free model (no API key required)` line is gone.                                                                            |
| C.6  | Check ai-worker logs (see “Watching the logs”) | `API key resolved from user wallet` with `source: "user"`. Before Pass B the same field read `source: "system"` alongside “Using system API key in Guest Mode (free models only)”. |

_C.5 is the load-bearing one: it is the only step that proves the key reached
the generation path rather than just the UI._

---

## Pass D — Presets, defaults, and overrides

**Proves**: the four-tier resolution order, and that the slot axis is honoured.
Requires the key from Pass B (a guest cannot select a paid preset).

**Setup**: you need at least **two** distinguishable presets — the one you
create in D.1, plus any existing 🌐 global preset from `/preset browse` (there
is always at least one; the system default). Create yours:

| Step | Action                                                                       | Expected                                                                                                                                                                                                                                                                               |
| ---- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D.1  | `/preset create`                                                             | A modal **Create New Preset**. Fill in a name and a model id.                                                                                                                                                                                                                          |
| D.2  | Submit                                                                       | The preset dashboard embed opens with edit buttons. (A duplicate name returns ❌ “A preset with name … already exists.” plus a retry button that reopens the modal prefilled.)                                                                                                         |
| D.3  | `/preset browse` filter:**My Presets**                                       | Your new preset appears with the 🔒 owned badge. Global presets carry 🌐.                                                                                                                                                                                                              |
| D.4  | `/preset default set` preset:`<your preset>`                                 | Embed **✅ Default Preset Set** — “Your default chat preset is now **\<name\>**. This will be used for all characters unless you have a specific override.” Footer: “Use /preset default clear to remove this setting”.                                                                |
| D.5  | Message **two different** characters, neither with an override               | Both footers name the model from your default preset.                                                                                                                                                                                                                                  |
| D.6  | `/preset override set` character:`<character A>` preset:`<the other preset>` | Embed **✅ Preset Override Set** — “**\<Character A\>** will now use the **\<preset\>** preset for chat messages.” Footer: “Use /preset override clear to remove this override”.                                                                                                       |
| D.7  | Message character A                                                          | Footer names the **override's** model (tier 1 beats tier 2).                                                                                                                                                                                                                           |
| D.8  | Message character B                                                          | Footer still names the **default's** model (tier 2 applies where there is no override).                                                                                                                                                                                                |
| D.9  | `/preset override browse`                                                    | A list of your overrides with a select menu (“Select an override to clear…”). Character A is listed.                                                                                                                                                                                   |
| D.10 | Select character A's row, confirm the clear                                  | The override is removed. Re-running `/preset override browse` with none left shows “You haven't set any preset overrides — use `/preset override set` …”.                                                                                                                              |
| D.11 | `/preset override clear` character:`<character A>` (already clear)           | Embed **ℹ️ No Override Set** — “This character was already using its default preset.”                                                                                                                                                                                                  |
| D.12 | `/preset default set` preset:`<a vision-capable preset>` slot:**Vision**     | **✅ Default Preset Set** — “Your default **vision (image)** preset is now …”. Your chat default is unchanged (D.13 checks this).                                                                                                                                                      |
| D.13 | `/preset default clear` slot:**Chat**                                        | **✅ Default Preset Cleared** with **one** fallback line beginning `**Chat** →`. The vision default from D.12 survives.                                                                                                                                                                |
| D.14 | `/preset default clear` with **no** slot                                     | **✅ Default Preset Cleared** with fallback lines for **both** `**Chat**` and `**Vision**`, each naming the system default it falls back to (or saying no system default is configured). Closing line: “Characters with their own per-character overrides will continue to use those.” |
| D.15 | Message a character                                                          | Footer names the character's own preset or the system default — not the preset you just cleared.                                                                                                                                                                                       |

_D.13 vs D.14 is the whole point of the slot axis: a slot-less clear must clear
both, a slot-scoped clear must clear exactly one._

---

## Pass E — Multiple providers

**Proves**: keys are per-provider, and that the LLM guest-mode decision is
driven by a chat-capable key (OpenRouter or z.ai Coding Plan) specifically.

**Rate-limit budget**: 2 writes. Skip this pass if you have no second provider key.

**Setup**: start from Pass B's state (an OpenRouter key stored).

| Step | Action                                                    | Expected                                                                                                                                                     |
| ---- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| E.1  | `/settings apikey set` provider:**ElevenLabs (Voice)**    | Modal titled **Set ElevenLabs API Key**, placeholder `sk_xxxx...`. Submit a valid key ⇒ **✅ API Key Configured**.                                           |
| E.2  | `/settings apikey browse`                                 | **Two** rows — OpenRouter and ElevenLabs — each with its own status and slug. Neither key value is displayed.                                                |
| E.3  | `/settings apikey test` provider:**ElevenLabs (Voice)**   | **✅ API Key Valid**. A Credit Balance field may appear (ElevenLabs reports remaining quota); the other providers show none.                                 |
| E.4  | `/settings apikey remove` provider:**ElevenLabs (Voice)** | Embed **🗑️ API Key Removed** — “Your **ElevenLabs** API key has been deleted. The bot will now use the default system key (if available) for this provider.” |
| E.5  | `/settings apikey browse`                                 | Only the OpenRouter row remains — removing one provider does not touch another.                                                                              |

**Voice keys don't buy models — both services agree on this.** Chat guest-mode
is decided by whether you hold an active **chat-capable** key (OpenRouter, or a
z.ai Coding Plan key); ElevenLabs and Mistral are voice-only. So with only an
ElevenLabs or Mistral key stored, the UI and the generation path line up:
`/preset browse` shows the Guest Mode preamble **and** a chat response carries
the `🆓 Using free model` footer. To check that combination, remove the
OpenRouter key first (Pass F), store only a voice key, and record both
observables.

One nuance survives, per §0.3: the ai-worker's z.ai promotion is
preset-dependent — a zai-coding key exits guest mode only for presets targeting
a `z-ai/<model>` on the coding-plan catalog — while the bot-client UI treats a
zai-coding key as full access globally. That optimism is deliberate (the UI
never blocks what the worker would allow); the worker remains authoritative.

---

## Pass F — Removing the key

**Proves**: removal takes effect on the generation path promptly (Redis pub/sub
invalidation, not just the 10-second cache expiry).

**Rate-limit budget**: 1–2 writes.

| Step | Action                                            | Expected                                                                                                                                                                                                  |
| ---- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F.1  | Message a character; note the footer              | `Model: …` only, no guest line (you still hold the key).                                                                                                                                                  |
| F.2  | `/settings apikey remove` provider:**OpenRouter** | Embed **🗑️ API Key Removed**, footer “Use /settings apikey set to configure a new key”.                                                                                                                   |
| F.3  | **Immediately** message a character again         | The footer gains the `🆓 Using free model (no API key required)` line and the model is a free one. A stale paid model here means invalidation did not propagate — record it as a fail with the timestamp. |
| F.4  | `/settings apikey browse`                         | Back to the empty-state text from A.1.                                                                                                                                                                    |
| F.5  | `/models browse` (wait ~30 s first, per §0.2)     | Paid models are 🔑 again.                                                                                                                                                                                 |

---

## Pass G — Error paths

**Proves**: each failure has its own message, and an unusable key never reaches
storage.

**Rate-limit budget**: G.2, G.3 and G.4 each consume one of the ten writes — the
limiter counts the request, not its success. G.1 does not (it fails client-side,
before any request). G.5 deliberately exhausts the budget, so run it last.

| Step | Action                                                                       | Expected                                                                                                                                                                                                                                                                           |
| ---- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G.1  | `/settings apikey set` provider:**OpenRouter**, submit `not-a-real-key`      | ❌ **Invalid OpenRouter Key Format** — “OpenRouter API keys should start with `sk-or-`.” Nothing is stored. (A value under 10 characters is rejected by Discord before submit.)                                                                                                    |
| G.2  | `/settings apikey set` provider:**OpenRouter**, submit `sk-or-v1-` + garbage | ❌ **Invalid API Key** with the three-bullet checklist. **The key is NOT stored** — `/settings apikey browse` still shows no OpenRouter row. Correct-format-but-wrong-key is rejected at the gateway, which validates against the provider before writing.                         |
| G.3  | `/settings apikey remove` provider:**Mistral (Voxtral TTS/STT)** (never set) | `❌ You don't have an API key configured for **Mistral (Voxtral TTS/STT)**.`                                                                                                                                                                                                       |
| G.4  | `/settings apikey test` provider:**Mistral (Voxtral TTS/STT)** (never set)   | `❌ You don't have an API key configured for **Mistral (Voxtral TTS/STT)**.` followed by “Use `/settings apikey set` to add your API key first.”                                                                                                                                   |
| G.5  | Repeat `/settings apikey test` until you exceed **10 writes in 15 minutes**  | `⏳ Too many key operations in a short window. Your **\<provider\>** key wasn't tested — please wait a moment and try again.` — a throttle message, never an “invalid key” message. (The `set` modal's throttle reads **⚠️ Too Many Requests** instead; both are ⏳/⚠️, never ❌.) |

Two failure shapes worth recognising if you hit them incidentally:

- **⏳ Request Timed Out** — “Your key may already have been saved — check `/settings apikey browse` before trying again.” Do exactly that; do not blind-retry.
- **⚠️ Couldn't verify your \<provider\> key — the provider didn't respond normally** — the provider was unreachable. Your key was **not** judged invalid.

---

## Pass H — Owner-only

**Proves**: the global default tiers and the usage rollup. Skip unless you are
the bot owner; every command here refuses other users.

| Step | Action                                                              | Expected                                                                                                                                                            |
| ---- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H.1  | `/preset global default` preset:`<a global preset>`                 | Embed **System Default Preset Updated** — “**\<name\>** is now the system default preset. Characters without a specific config will use this default.”              |
| H.2  | With no personal default and no override, message a character       | The footer names H.1's model (tier 4 applies).                                                                                                                      |
| H.3  | `/preset global free-default` preset:`<a free-model global preset>` | Embed **Free Tier Default Preset Updated** — “**\<name\>** is now the free tier default preset. Guest users without API keys will use this model for AI responses.” |
| H.4  | As a user with **no** key, message a character                      | The footer names H.3's model, plus the `🆓 Using free model` line.                                                                                                  |
| H.5  | `/preset global default` slot:**Vision** preset:`<a vision preset>` | Same **System Default Preset Updated** embed; the chat default is untouched.                                                                                        |
| H.6  | `/admin usage`                                                      | The global usage embed (all users). Optional `timeframe`: Last 24 hours / 7 days / 30 days; default 7d.                                                             |
| H.7  | Run `/preset global default` as a **non-owner**                     | `❌ Owner-only command. This command is restricted to the bot owner.` — nothing is changed.                                                                         |

There is **no per-user usage command**; `/admin usage` is the only usage surface
and it is owner-scoped and global. Per-user totals come from the SQL in Pass I.

---

## Pass I — Data at rest (requires a terminal, not a phone)

**Proves**: keys are stored encrypted and usage is recorded even under BYOK.

```bash
# Keys are encrypted: iv / content / tag are opaque, and no column holds `sk-or-…`.
# The single quotes matter: `ops run` injects DATABASE_URL into the child env
# with shell interpretation off, so the variable must be expanded by the
# wrapped bash — a double-quoted "$DATABASE_URL" would expand (empty) in YOUR
# shell before pnpm even runs, and psql would silently hit the wrong database.
pnpm ops run --env dev -- bash -c \
  'psql "$DATABASE_URL" -c "SELECT provider, is_active, left(iv, 8) AS iv_head, left(content, 16) AS content_head, left(tag, 8) AS tag_head, last_used_at FROM user_api_keys LIMIT 5"'
```

Expected: `iv_head` / `content_head` / `tag_head` are hex-ish noise. **Fail the
step immediately if any of them starts with `sk-`.**

```bash
# Usage is logged even for BYOK requests (same quoting rule as above).
pnpm ops run --env dev -- bash -c \
  'psql "$DATABASE_URL" -c "SELECT provider, model, tokens_in, tokens_out, request_type, created_at FROM usage_logs ORDER BY created_at DESC LIMIT 5"'
```

Expected: a row per recent request, naming the model the footer showed you.

---

## Watching the logs

```bash
# Which key served a request — 'user' (BYOK) vs 'system' (guest mode)
railway logs --service ai-worker | grep -E "API key resolved|Guest Mode|source"

# Key writes, validation, and cache-invalidation publishes
railway logs --service api-gateway | grep -iE "api key|wallet|invalidat"

# Command dispatch
railway logs --service bot-client | grep -iE "apikey|preset|command"

# Errors
railway logs --service ai-worker | grep -iE "error|failed|exception"
```

The exact lines to look for:

| Line                                                    | Means                                          |
| ------------------------------------------------------- | ---------------------------------------------- |
| `API key resolved from user wallet` (`source: "user"`)  | Your BYOK key served the request.              |
| `Using system API key in Guest Mode (free models only)` | No user key — free models only.                |
| `API key resolved from cache` (`source: "cache"`)       | Within the 10-second resolution cache window.  |
| `API_KEY_ENCRYPTION_KEY not set - BYOK disabled`        | BYOK is off entirely; every key is ignored.    |
| `Published API key cache invalidation event`            | A set/remove propagated to the ai-worker pool. |

---

## Troubleshooting

**“My key is stored but responses still say 🆓 Using free model.”**
The guest-mode decision reads your **OpenRouter** key. A key for ElevenLabs or
Mistral does not change it, and a Z.AI Coding Plan key changes it only when the
resolved preset targets a `z-ai/<model>` on the coding-plan catalog (§0.3).
Confirm with `/settings apikey browse` that the OpenRouter row exists and is
Active, then check ai-worker logs for `source: "user"`.

**“The bot says my key is invalid, but it works on the provider's site.”**
The gateway validates against the provider before storing, so this is the
provider's own answer. Check for a scoped key missing permissions (that returns a
descriptive **Validation Error**, not the generic invalid message) and for a zero
credit balance (**Insufficient Credits**).

**“Nothing happens / I keep getting a throttle message.”**
Ten wallet writes per 15 minutes, shared across set/test/remove. Wait it out —
`/settings apikey browse` reads are on a separate, far more generous budget.

**“A key change didn't take effect.”**
Resolution is cached 10 seconds and invalidated over Redis pub/sub on change.
Longer than that is a real failure — capture the api-gateway log around the write
(`Published API key cache invalidation event`) and report it.

**“The command doesn't exist.”**
Commands register on bot-client deploy. Confirm the deploy finished, then check
`/help commands`.

**“A model I expected is not being used.”**
Walk §0.5 top-down: per-character override → your default → the character's own
preset → the system default — and remember guest mode substitutes a free model
at the end of that chain regardless of which tier won.
