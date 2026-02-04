/**
 * Discord Constants
 *
 * Discord API limits, colors, and text truncation limits.
 */

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
  /** Discord message content character limit */
  MESSAGE_LENGTH: 2000,
  /** Discord embed description character limit */
  EMBED_DESCRIPTION: 4096,
  /** Discord embed field value character limit */
  EMBED_FIELD: 1024,
  /** Maximum avatar file size (10MB) */
  AVATAR_SIZE: 10 * 1024 * 1024,
  /** Maximum webhook cache size */
  WEBHOOK_CACHE_SIZE: 100,
  /** Maximum number of autocomplete choices Discord allows */
  AUTOCOMPLETE_MAX_CHOICES: 25,
  /** Maximum length for modal text input (paragraph style) */
  MODAL_INPUT_MAX_LENGTH: 4000,
  /** Discord modal title character limit */
  MODAL_TITLE_MAX_LENGTH: 45,
  /** Safe length for dynamic content in modal title (accounting for prefix like "Persona for ") */
  MODAL_TITLE_DYNAMIC_CONTENT: 30,
  /** Timeout for button collector interactions (30 seconds) */
  BUTTON_COLLECTOR_TIMEOUT: 30000,
} as const;

/**
 * Gateway API timeout constants for Discord interactions.
 *
 * Discord requires autocomplete responses within 3 seconds.
 * After deferral (deferReply), we have up to 15 minutes.
 * These timeouts are for gateway API calls that must complete
 * within Discord's interaction windows.
 */
export const GATEWAY_TIMEOUTS = {
  /** Timeout for autocomplete handlers (Discord 3s limit) */
  AUTOCOMPLETE: 2500,
  /** Timeout for deferred operations (post-deferReply) */
  DEFERRED: 10000,
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
 * Prefix used for unresolved Discord user IDs in personaId fields.
 *
 * Extended context uses 'discord:XXXX' format for users before persona
 * resolution. After resolution, these become actual persona UUIDs.
 *
 * @example
 * // Before resolution
 * personaId: 'discord:123456789012345678'
 * // After resolution
 * personaId: 'uuid-abc-123-def-456'
 */
export const DISCORD_ID_PREFIX = 'discord:';

/**
 * Discord Snowflake ID validation
 *
 * Discord IDs (snowflakes) are 64-bit integers represented as strings.
 * They are 17-19 digits long (growing over time as timestamps increase).
 * Examples: "123456789012345678", "1234567890123456789"
 */
export const DISCORD_SNOWFLAKE = {
  /**
   * Regex pattern for validating Discord snowflake IDs
   * Matches 17-19 digit numeric strings
   */
  PATTERN: /^\d{17,19}$/,

  /**
   * Minimum length of a Discord snowflake ID
   */
  MIN_LENGTH: 17,

  /**
   * Maximum length of a Discord snowflake ID
   */
  MAX_LENGTH: 19,
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
 * Currently only OpenRouter is supported for BYOK.
 * OpenAI is not offered because BYOK doesn't cover embeddings/whisper costs.
 * Gemini is not offered (we use OpenRouter for all LLM calls).
 *
 * These are the choices displayed in /wallet and /llm-config commands.
 */
export const DISCORD_PROVIDER_CHOICES = [{ name: 'OpenRouter', value: 'openrouter' }] as const;

/**
 * Type for provider choice values
 */
export type DiscordProviderChoice = (typeof DISCORD_PROVIDER_CHOICES)[number]['value'];

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
  /** Focus mode indicator (LTM retrieval disabled) */
  FOCUS_MODE: '🔒 Focus Mode • LTM retrieval disabled',
  /** Incognito mode indicator (memories not saved) */
  INCOGNITO_MODE: '👻 Incognito Mode • Memories not being saved',
} as const;

/**
 * Build a model footer line for Discord messages.
 *
 * @param modelUsed - Model name to display
 * @param modelUrl - Full URL to the model card
 * @param withAutoBadge - Include auto-response badge on same line
 * @returns Footer line WITHOUT leading newline (caller adds `-# ` prefix)
 */
export function buildModelFooterText(
  modelUsed: string,
  modelUrl: string,
  withAutoBadge = false
): string {
  // Defensive: sanitize model name to prevent markdown injection
  // (brackets and angle brackets could break link syntax)
  const sanitizedModel = modelUsed.replace(/[[\]()<>]/g, '');
  const base = `Model: [${sanitizedModel}](<${modelUrl}>)`;
  return withAutoBadge ? `${base}${BOT_FOOTER_TEXT.AUTO_BADGE_COMPACT}` : base;
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
 * - duplicateDetection: Strips footers before similarity comparison
 *
 * NOTE: Keep these patterns in sync with BOT_FOOTER_TEXT constants above.
 */
export const BOT_FOOTER_PATTERNS = {
  /** Model indicator (with optional auto badge on same line) */
  MODEL: /(?:^|\n)-# Model: \[[^\]]+\]\(<[^>]+>\)(?: • 📍 auto)?/g,
  /** Guest mode notice - uses GUEST_MODE.FOOTER_MESSAGE from ai.ts */
  GUEST_MODE: /(?:^|\n)-# 🆓 Using free model \(no API key required\)/g,
  /** Auto-response indicator (standalone) */
  AUTO_RESPONSE: /(?:^|\n)-# 📍 auto-response/g,
  /** Focus mode indicator (LTM retrieval disabled) */
  FOCUS_MODE: /(?:^|\n)-# 🔒 Focus Mode • LTM retrieval disabled/g,
  /** Incognito mode indicator (memories not saved) */
  INCOGNITO_MODE: /(?:^|\n)-# 👻 Incognito Mode • Memories not being saved/g,
} as const;
