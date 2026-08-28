/**
 * Discord Constants
 *
 * Discord API limits, colors, and text truncation limits.
 */

import { isChatCapableProvider, stripZaiPrefix } from './ai.js';
import type { QuotaFallbackCategoryValue } from './error.js';

/**
 * Text truncation and preview limits
 */
export const TEXT_LIMITS = {
  /** Characters for log message previews */
  LOG_PREVIEW: 150,
  /** Characters for persona preview in logs */
  LOG_PERSONA_PREVIEW: 100,
  /** Characters for URL preview in logs (shows start of URL for debugging) */
  URL_LOG_PREVIEW: 60,
  /** Character limit before truncating full prompt in logs */
  LOG_FULL_PROMPT: 2000,
  /** Summary truncation in admin commands */
  ADMIN_SUMMARY_TRUNCATE: 1000,
  /** Discord embed field character limit */
  DISCORD_EMBED_FIELD: 1024,
  /** Short preview for personality cards (200 chars) */
  PERSONALITY_PREVIEW: 200,
  /** Medium preview for referenced messages (500 chars) */
  REFERENCE_PREVIEW: 500,
  /** Max characters for deduplicated reference stub content before truncation */
  DEDUP_STUB_CONTENT: 100,
  /** Suffix appended when text is truncated (ellipsis + note) */
  TRUNCATION_SUFFIX: '…\n\n_(truncated)_',
} as const;

/**
 * Character view truncation limits
 *
 * These limits are used when displaying character details in paginated embeds.
 * Each field type has a different limit based on typical content length.
 */
export const CHARACTER_VIEW_LIMITS = {
  /** Short fields like age - concise single value */
  SHORT: 200,
  /** Medium fields like tone, appearance, likes, dislikes - brief descriptions */
  MEDIUM: 500,
  /** Long fields like conversational goals/examples, error messages - detailed content */
  LONG: 800,
} as const;

/**
 * Discord API limits and constraints
 */
export const DISCORD_LIMITS = {
  /** Discord's bot/webhook message content character limit (Nitro-independent —
   *  a Nitro subscription raises what a HUMAN may type, never what the API
   *  accepts from a bot). The chunk budget every sender splits against. */
  MESSAGE_LENGTH: 2000,
  /** Discord embed description character limit */
  EMBED_DESCRIPTION: 4096,
  /** Discord embed field value character limit */
  EMBED_FIELD: 1024,
  /** Discord embed title character limit */
  EMBED_TITLE: 256,
  /** Discord embed field NAME character limit */
  EMBED_FIELD_NAME: 256,
  /** Discord embed footer text character limit */
  EMBED_FOOTER: 2048,
  /** Maximum avatar file size (10MB) */
  AVATAR_SIZE: 10 * 1024 * 1024,
  /** Maximum webhook cache size */
  WEBHOOK_CACHE_SIZE: 100,
  /** Maximum number of autocomplete choices Discord allows */
  AUTOCOMPLETE_MAX_CHOICES: 25,
  /** Maximum length for modal text input (paragraph style) */
  MODAL_INPUT_MAX_LENGTH: 4000,
  /** Max `message` option length on the `/chat`-family commands — Nitro's max
   *  message length, so a Nitro user can hand a character everything they could
   *  have typed by hand. Deliverable despite exceeding MESSAGE_LENGTH because
   *  the channel echo is chunked at send time (characterTurn.ts). Distinct from
   *  MODAL_INPUT_MAX_LENGTH: same number, unrelated surface. */
  CHAT_MESSAGE_INPUT_MAX_LENGTH: 4000,
  /** Maximum length for short paragraph fields (traits, tone, error message) */
  SHORT_PARAGRAPH_MAX_LENGTH: 1000,
  /** Maximum length for a personality slug (mirrors slugSchema's .max in personality.ts; edit-modal caps must match to avoid a 400) */
  SLUG_MAX_LENGTH: 50,
  /** Discord modal title character limit */
  MODAL_TITLE_MAX_LENGTH: 45,
  /** Safe length for dynamic content in modal title (accounting for prefix like "Persona for ") */
  MODAL_TITLE_DYNAMIC_CONTENT: 30,
  /** Timeout for button collector interactions (30 seconds) */
  BUTTON_COLLECTOR_TIMEOUT: 30000,
  /** Maximum file upload size for non-Nitro servers (8 MiB — binary units, matches constant) */
  FILE_UPLOAD_MAX_BYTES: 8 * 1024 * 1024,
} as const;

/**
 * Gateway API timeout constants for Discord interactions.
 *
 * Discord requires autocomplete responses within 3 seconds.
 * After deferral (deferReply), we have up to 15 minutes.
 * These timeouts are for gateway API calls that must complete
 * within Discord's interaction windows.
 *
 * Read/write policy: reads default to DEFERRED (10s) — almost every read is
 * invoked post-defer, so the tight AUTOCOMPLETE budget is opt-in (only for the
 * few autocomplete-invoked routes, guarded in the clients package's
 * manifest.test.ts). Mutations (POST/PUT/PATCH/DELETE) get WRITE — they can run
 * validation + multi-table transactions + cache-invalidation cascades, which
 * legitimately exceed the read budgets. The transport (see `callGateway`)
 * applies these method-aware defaults when a route declares no timeout, so a
 * route can't silently inherit a too-short budget. BULK_OPERATION is the
 * explicit ceiling for batched external-API ops.
 */
export const GATEWAY_TIMEOUTS = {
  /** Timeout for autocomplete handlers (Discord 3s limit) */
  AUTOCOMPLETE: 2500,
  /** Timeout for deferred operations (post-deferReply).
   *  10s is generous for warmed DB connections — the api-gateway now calls
   *  prisma.$connect() at startup to eliminate cold-start latency. */
  DEFERRED: 10000,
  /** Default for mutations (POST/PUT/PATCH/DELETE). Writes can touch validation +
   *  multi-table transactions + cache-invalidation cascades; 20s absorbs that
   *  without falsely aborting a slow-but-succeeding write (the failure mode
   *  behind the llm-config PUT timeouts). Still well within the 15-min
   *  post-defer window. Applied automatically by the transport for write
   *  methods that declare no explicit timeout. */
  WRITE: 20_000,
  /** Extended timeout for bulk operations (e.g., clearing all cloned voices).
   *  These involve multiple sequential/batched external API calls. */
  BULK_OPERATION: 30_000,
  /** Data-scaled owner maintenance sync (db-sync, cleanup): duration grows
   *  with table size — a fact-carrying db-sync exceeded BULK_OPERATION and
   *  succeeded AFTER the client aborted (false-failure UX). 5 min sits well
   *  inside Discord's 15-min deferred-interaction window, and verified
   *  client-binding: the gateway sets no server timeouts (Node leaves
   *  in-flight response duration unlimited by default) and bot→gateway
   *  rides the Railway-INTERNAL domain, bypassing the public edge proxy.
   *  Owner decision: raise now; the async-job refactor is filed with a
   *  promote-when trigger (sync past ~2 min) rather than improvised. */
  LONG_SYNC: 300_000,
  /** Client timeout for a route whose handler makes synchronous external-provider
   *  calls — sequential or parallel; what matters is the worst-case internal
   *  budget, not the call count (`listVoices` fans out to two providers in
   *  parallel, so its ceiling is the slowest single call, not their sum).
   *  Used by key validation, voice-provider list, shapes fetch.
   *  Must exceed the handler's internal call budget (the VALIDATION_TIMEOUTS.* —
   *  ≤30s today) plus auth/provisioning/DB/network overhead, so the client
   *  outwaits the gateway instead of aborting while it's still succeeding. Pair
   *  with a route's `externalCallBudgetMs`; the manifest test enforces the gap. */
  EXTERNAL_PROVIDER: 40_000,
} as const;

/**
 * Discord brand colors (hex values)
 */
export const DISCORD_COLORS = {
  /** Discord Blurple (brand color) */
  BLURPLE: 0x5865f2,
  /** Success (green) */
  SUCCESS: 0x00ff00,
  /** Warning (orange) */
  WARNING: 0xffa500,
  /** Error (red) */
  ERROR: 0xff0000,
} as const;

/**
 * Discord mention patterns and limits
 */
export const DISCORD_MENTIONS = {
  /**
   * Regex pattern string for Discord user mentions
   * Matches both <@123456> and <@!123456> (nickname indicator) formats
   * Use with 'g' flag for global matching: new RegExp(DISCORD_MENTIONS.USER_PATTERN, 'g')
   */
  USER_PATTERN: '<@!?(\\d+)>',
  /**
   * Regex pattern string for Discord channel mentions
   * Matches <#123456> format
   * Use with 'g' flag for global matching: new RegExp(DISCORD_MENTIONS.CHANNEL_PATTERN, 'g')
   */
  CHANNEL_PATTERN: '<#(\\d+)>',
  /**
   * Regex pattern string for Discord role mentions
   * Matches <@&123456> format
   * Use with 'g' flag for global matching: new RegExp(DISCORD_MENTIONS.ROLE_PATTERN, 'g')
   */
  ROLE_PATTERN: '<@&(\\d+)>',
  /**
   * Regex pattern string matching ANY single Discord mention — user (with or
   * without nickname-bang), role, or channel — plus the text-rendered `@name`
   * form. Use when you want to detect or strip mentions regardless of type,
   * e.g., to skip leading mentions in content before comparing text.
   *
   * No anchors, no capture groups — compose for specific needs (anchor with
   * `^` for leading-only, add `g` flag for global scan, etc.).
   *
   * Note on text-form breadth: `@\S+` intentionally matches `@everyone`,
   * `@here`, and any `@word` token, not just rendered username mentions.
   * For the leading-strip use cases this is correct — all of those belong
   * in the "mention prefix to skip" bucket.
   */
  ANY_PATTERN: '(?:@\\S+|<@!?\\d+>|<@&\\d+>|<#\\d+>)',
  /** Maximum user mentions to process per message (DoS prevention) */
  MAX_PER_MESSAGE: 10,
  /** Maximum channel mentions to process per message (DoS prevention) */
  MAX_CHANNELS_PER_MESSAGE: 5,
  /** Maximum role mentions to process per message (DoS prevention) */
  MAX_ROLES_PER_MESSAGE: 5,
  /** Placeholder text for unresolvable channel mentions */
  UNKNOWN_CHANNEL_PLACEHOLDER: '#unknown-channel',
  /** Placeholder text for unresolvable role mentions */
  UNKNOWN_ROLE_PLACEHOLDER: '@unknown-role',
} as const;

/**
 * Discord Snowflake ID validation
 *
 * Discord IDs (snowflakes) are unsigned 64-bit integers represented as
 * strings: 17-19 digits today (growing over time as timestamps increase),
 * and never more than 20 digits (the string length of u64::MAX). The regex
 * bounds LENGTH only — a 20-digit string above u64::MAX still matches; a
 * value-level check isn't worth the string-compare it would take. THE
 * canonical range — the API-schema validator (`DiscordSnowflakeSchema`)
 * derives from this pattern, the `personas_name_not_snowflake` DB CHECK
 * mirrors it, and the user-provisioning write guard enforces it, so a
 * second, narrower copy would silently refuse ids the HTTP boundary accepts.
 * Examples: "123456789012345678", "1234567890123456789"
 */
export const DISCORD_SNOWFLAKE = {
  /**
   * Unanchored 17-20 digit source fragment for composing larger patterns
   * (mention tokens, message links). Use PATTERN for whole-string validation.
   */
  SOURCE: String.raw`\d{17,20}`,

  /**
   * Regex pattern for validating Discord snowflake IDs
   * Matches 17-20 digit numeric strings (the anchored form of SOURCE —
   * keep the two in sync)
   */
  PATTERN: /^\d{17,20}$/,

  /**
   * Minimum length of a Discord snowflake ID
   */
  MIN_LENGTH: 17,

  /**
   * Maximum length of a Discord snowflake ID (the string length of u64::MAX)
   */
  MAX_LENGTH: 20,
} as const;

/**
 * Validate a Discord snowflake ID
 * @param id - The ID to validate
 * @returns true if valid Discord snowflake format
 */
export function isValidDiscordId(id: string): boolean {
  return DISCORD_SNOWFLAKE.PATTERN.test(id);
}

/**
 * Filter array to only valid Discord IDs
 * @param ids - Array of potential IDs
 * @returns Array of valid Discord snowflake IDs
 */
export function filterValidDiscordIds(ids: string[]): string[] {
  return ids.filter(isValidDiscordId);
}

/**
 * AI Provider choices for Discord slash commands
 *
 * OpenRouter: LLM chat/generation (access to all AI models)
 * ElevenLabs: Premium voice synthesis and cloning (BYOK)
 * Z.AI Coding Plan: GLM-family direct routing for users with a coding-plan
 *   subscription; users without a key auto-fall through to OpenRouter via
 *   ProviderRouter (see services/ai-worker/src/services/ProviderRouter.ts).
 *
 * These are the choices displayed in /settings apikey commands.
 */
export const DISCORD_PROVIDER_CHOICES = [
  { name: 'OpenRouter', value: 'openrouter' },
  { name: 'ElevenLabs (Voice)', value: 'elevenlabs' },
  { name: 'Z.AI Coding Plan', value: 'zai-coding' },
  { name: 'Mistral (Voxtral TTS/STT)', value: 'mistral' },
] as const;

/**
 * Bot-added footer text constants.
 *
 * Single source of truth for footer strings used in Discord messages.
 * Used by DiscordResponseSender and character/chat.ts for generation,
 * and by BOT_FOOTER_PATTERNS for stripping from conversation context.
 *
 * IMPORTANT: When adding new footer types, add both the text constant
 * here AND the corresponding regex pattern in BOT_FOOTER_PATTERNS below.
 */
export const BOT_FOOTER_TEXT = {
  /** Auto-response badge (compact, appended to model footer line) */
  AUTO_BADGE_COMPACT: ' • 📍 auto',
  /** Auto-response indicator (standalone, when no model shown) */
  AUTO_RESPONSE: '📍 auto-response',
  /** Fresh mode indicator (LTM retrieval disabled; memories kept) */
  FRESH_MODE: '🌱 Fresh Mode • Memories not being used',
  /** Incognito mode indicator (memories not saved) */
  INCOGNITO_MODE: '👻 Incognito Mode • Memories not being saved',
} as const;

/**
 * Provider values that serve LLM (text) generation — the ONLY ones eligible for the
 * model footer's "via <label>". `DISCORD_PROVIDER_CHOICES` deliberately mixes LLM
 * (openrouter, zai-coding) and voice (elevenlabs, mistral) providers; only LLM providers
 * ever populate the model footer's `providerUsed`, so this allowlist makes that
 * constraint STRUCTURAL — a voice provider can never surface as "• via ElevenLabs (Voice)"
 * on an LLM response even if a future change wired one into the LLM `providerUsed` path.
 *
 * The allowlist is `isChatCapableProvider` — the single classification of which
 * providers serve LLM generation, shared with the guest-mode predicates — so the
 * footer and the UI can never disagree about what counts as an LLM provider.
 *
 * Provider value → human-readable footer label, derived from the slash-command
 * choices so the two never drift. Used to make the served-by provider explicit in
 * the model footer (e.g. "via Z.AI Coding Plan" vs "via OpenRouter") rather than
 * leaving users to infer it from the `z-ai/` vendor-prefix.
 */
const PROVIDER_FOOTER_LABEL: Readonly<Record<string, string>> = Object.fromEntries(
  DISCORD_PROVIDER_CHOICES.filter(choice => isChatCapableProvider(choice.value)).map(choice => [
    choice.value,
    choice.name,
  ])
);

/** Options for {@link buildModelFooterText}. */
export interface ModelFooterOptions {
  /**
   * Provider that actually served the request (the EFFECTIVE provider after any
   * auto-promotion fallback). Rendered as "• via <label>" when it maps to a
   * known label; omitted otherwise.
   */
  provider?: string;
  /**
   * Provider of the auto-promotion fallback route that was attempted and ALSO
   * failed — set only on a both-routes-failed error. When both providers map
   * to known labels, the attribution renders as a route chain
   * ("• via <primary> → <fallback> (both routes failed)") so the footer names
   * every route that was tried, not just the primary.
   */
  fallbackProviderAttempted?: string;
  /** Include the auto-response badge on the same line. */
  withAutoBadge?: boolean;
  /**
   * Tier-aware quota fallback that fired for this turn. Renders the swap as
   * the model line itself — "Model: <from> → [<to>](<url>) (<per-category
   * reason>)" — see QUOTA_FALLBACK_REASON; a model swap is never
   * silent (an unexplained voice shift reads as a bug, and "why did I get
   * the free model" must be answerable from the reply itself). `modelUsed`
   * already IS the target model; this names where the request started.
   *
   * When `fromModel` and `modelUsed` name the SAME model (see
   * {@link namesSameModel} — the `z-ai/`-prefixed and bare spellings of the
   * piggyback are one model on two routes), the chain collapses to
   * "Model: [<to>](<url>) (<reason>)": the reason still explains the
   * substitution, but nothing pretends the model changed.
   */
  quotaFallback?: {
    fromModel: string;
    category: QuotaFallbackCategoryValue;
  };
}

/**
 * Footer wording per announceable swap reason (D12 descent included, plus the
 * non-failure guest-mode substitution).
 */
const QUOTA_FALLBACK_REASON: Record<QuotaFallbackCategoryValue, string> = {
  quota_exceeded: 'rate limited',
  rate_limit: 'rate limited',
  credit_exhaustion: 'out of credit',
  model_not_found: 'model unavailable',
  server_error: 'provider error',
  timeout: 'timed out',
  network: 'network error',
  empty_response: 'empty response',
  censored: 'model refused',
  content_policy: 'model refused',
  guest_mode: 'guest mode',
};

/**
 * Do these two ids name the same model, allowing for the routing-prefix
 * duality? The piggyback model is `z-ai/glm-5.3-flash` when routed through
 * OpenRouter and bare `glm-5.3-flash` when served z.ai-direct, so a
 * substitution between the two forms changes the ROUTE, not the model — and
 * the route is already named by the ` • via <label>` attribution. Rendering
 * `Model: z-ai/glm-5.3-flash → glm-5.3-flash` for it reads as a model swap
 * that did not happen.
 *
 * Deliberately narrow: only the `z-ai/` prefix is stripped, because that is
 * the one prefix this codebase writes and drops for the SAME model as it
 * changes route (`ProviderRouter` bares the id for the z.ai-direct call).
 * A general "strip any `<vendor>/`" rule would collapse genuinely different
 * models whose ids happen to share a tail — `expensive/primary` → `primary`
 * is a real swap, and the arrow has to survive it.
 */
function namesSameModel(a: string, b: string): boolean {
  return stripZaiPrefix(a) === stripZaiPrefix(b);
}

/**
 * Build a model footer line for Discord messages.
 *
 * @param modelUsed - Model name to display
 * @param modelUrl - Full URL to the model card
 * @param options - Provider attribution + auto-badge modifiers
 * @returns Footer line WITHOUT leading newline (caller adds `-# ` prefix)
 */
export function buildModelFooterText(
  modelUsed: string,
  modelUrl: string,
  options: ModelFooterOptions = {}
): string {
  const { provider, fallbackProviderAttempted, withAutoBadge = false, quotaFallback } = options;
  // Defensive: sanitize model name to prevent markdown injection
  // (brackets and angle brackets could break link syntax)
  const sanitizedModel = modelUsed.replace(/[[\]()<>]/g, '');
  // The link rides the RESOLVED model wherever it ends up, so that model is
  // named exactly once. On a swap it is the arrow's target — the chain reads
  // `<from> → <to> (<reason>)` and the old leading mention is gone; the swap
  // footer used to print the resolved name twice, once linked at the front and
  // again as the target. With no swap there is nothing to point at and the
  // line is byte-identical to what it always was.
  const modelLink = `[${sanitizedModel}](<${modelUrl}>)`;
  let text: string;
  if (quotaFallback !== undefined) {
    const sanitizedFrom = quotaFallback.fromModel.replace(/[[\]()<>]/g, '');
    const reason = QUOTA_FALLBACK_REASON[quotaFallback.category];
    // A route-only swap keeps the reason — "(guest mode)" still explains why
    // this model is serving — and drops the chain, which would otherwise name
    // the same model twice with an arrow between the two spellings.
    text = namesSameModel(quotaFallback.fromModel, modelUsed)
      ? `Model: ${modelLink} (${reason})`
      : `Model: ${sanitizedFrom} → ${modelLink} (${reason})`;
  } else {
    text = `Model: ${modelLink}`;
  }
  const providerLabel = provider !== undefined ? PROVIDER_FOOTER_LABEL[provider] : undefined;
  const fallbackLabel =
    fallbackProviderAttempted !== undefined
      ? PROVIDER_FOOTER_LABEL[fallbackProviderAttempted]
      : undefined;
  if (providerLabel !== undefined && fallbackLabel !== undefined) {
    text += ` • via ${providerLabel} → ${fallbackLabel} (both routes failed)`;
  } else if (providerLabel !== undefined) {
    text += ` • via ${providerLabel}`;
  }
  if (withAutoBadge) {
    text += BOT_FOOTER_TEXT.AUTO_BADGE_COMPACT;
  }
  return text;
}

/**
 * Bot-added footer patterns for Discord messages.
 *
 * The bot appends footer lines to Discord messages (model indicator,
 * auto-response badge, guest mode notice). These are for display only
 * and should NOT be stored in the database.
 *
 * IMPORTANT: These patterns must match ONLY our bot-added footers, not
 * user content. Users can legitimately use `-#` for small text formatting.
 *
 * Patterns use (?:^|\n) to match:
 * - Inline footers: "content\n-# Model:..." (newline before footer)
 * - Standalone footers: "-# Model:..." (entire message is footer)
 *
 * Used by:
 * - stripBotFooters (utils/discord.ts): Utility function to remove footers
 * - DiscordChannelFetcher: Strips footers during opportunistic sync
 * - ai-worker crossTurnDetection.ts and RetryDecisionHelper.ts: strip before
 *   similarity comparison, so a footer never counts as response text
 * - extractForwardedContentForPrompt (bot-client forwardedMessageUtils.ts):
 *   strips footers from a forwarded snapshot before it reaches the LLM prompt
 * - SnapshotFormatter.formatSnapshot (bot-client): calls stripBotFooters
 *   DIRECTLY rather than via the accessor above — it runs once per snapshot,
 *   while the accessor reads only the first
 *
 * NOTE: Keep these patterns in sync with BOT_FOOTER_TEXT constants above.
 */
export const BOT_FOOTER_PATTERNS = {
  /**
   * Model indicator, plus any same-line ` • …` tail (provider attribution
   * "• via <provider>" and/or the "• 📍 auto" badge). The tail is bounded to
   * the footer line (`[^\n]+`), so it strips the whole indicator without
   * over-reaching into following content.
   *
   * Two link POSITIONS must match, because {@link buildModelFooterText} moved
   * the link onto the swap chain's target and channel history still holds
   * messages written before that:
   * - current: `Model: [<model>](<url>)` — and on a swap
   *   `Model: <from> → [<to>](<url>) (<reason>)`, hence the optional
   *   `<from> → ` prefix (which excludes `[` so it can never swallow the
   *   link itself) and the optional ` (<reason>)` that follows it.
   * - pre-move: `Model: [<to>](<url>) • <from> → <to> (<reason>)`, still
   *   covered by the base shape plus the ` • …` tail.
   *
   * Both are exercised by the round-trip tests in `discord.test.ts`; a stale
   * pattern here does not fail loudly — it silently leaves footers in the
   * history fed back to the model, and in the text `stripBotFooters` feeds to
   * duplicate- and cross-turn detection.
   *
   * ACCEPTED WIDENING, against this block's "match ONLY our bot-added footers"
   * rule above: the optional prefix is generic (`[^\n[]*→ `) rather than an
   * alternation over the exact builder outputs, so a user line shaped like
   * `-# Model: foo → [bar](<https://x>)` now strips where it previously
   * survived. Deliberate — it needs a literal `→` AND a well-formed
   * `[text](<url>)` immediately after `-# Model: `, and the cost when it does
   * fire is the author's own quoted text missing from what is fed back to the
   * model, not any cross-user effect. The alternation would have to be
   * rewritten for every future footer shape, which is the maintenance failure
   * this pattern already had once.
   */
  MODEL: /(?:^|\n)-# Model: (?:[^\n[]*→ )?\[[^\]]+\]\(<[^>]+>\)(?: \([^()\n]*\))?(?: • [^\n]+)?/g,
  /** Guest mode notice - uses GUEST_MODE.FOOTER_MESSAGE from ai.ts */
  GUEST_MODE: /(?:^|\n)-# 🆓 Using free model \(no API key required\)/g,
  /** Auto-response indicator (standalone) */
  AUTO_RESPONSE: /(?:^|\n)-# 📍 auto-response/g,
  /** Fresh mode indicator (LTM retrieval disabled; memories kept) */
  FRESH_MODE: /(?:^|\n)-# 🌱 Fresh Mode • Memories not being used/g,
  /**
   * Pre-rename fresh-mode indicator ("Focus Mode"). Messages sent before the
   * rename still carry this footer in channel history, so it must keep being
   * stripped when history is fed back to the model.
   */
  LEGACY_FOCUS_MODE: /(?:^|\n)-# 🔒 Focus Mode • LTM retrieval disabled/g,
  /** Incognito mode indicator (memories not saved) */
  INCOGNITO_MODE: /(?:^|\n)-# 👻 Incognito Mode • Memories not being saved/g,
  /**
   * Transcription attribution (dynamic provider name + URL). Mirrors the
   * builder in bot-client `VoiceTranscriptionService.buildTranscriptionFooter`
   * (`-# Transcribed by [${name}](<${url}>)`) — keep the two in sync. The
   * `[..]` / `<..>` captures absorb the dynamic provider name and link.
   */
  TRANSCRIBED: /(?:^|\n)-# Transcribed by \[[^\]]+\]\(<[^>]+>\)/g,
} as const;
