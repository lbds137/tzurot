/**
 * Webhook-username naming utilities.
 *
 * Tzurot's personality webhook usernames have the shape
 * `${personality.displayName}${botSuffix}` where `botSuffix` is derived from
 * the bot's Discord tag (e.g. ` · Tzurot`). Multiple consumers need to parse
 * the format. Centralizing the knowledge here means a future separator change
 * is a one-file edit instead of a multi-file grep that's easy to miss on one
 * consumer.
 *
 * Two separators are supported on read paths:
 *  - ` · ` (middle dot) — current canonical format produced by WebhookManager
 *  - ` | ` (pipe) — legacy format from messages sent before the separator
 *    was switched. Stripping this lets us correctly attribute historical
 *    messages in extended-context fetches.
 *
 * Write paths (`WebhookManager.getBotSuffix`) emit only the canonical ` · `
 * form. The legacy form is read-only for backward compatibility.
 */

const SEPARATOR_CURRENT = ' · ';
const SEPARATOR_LEGACY = ' | ';

/**
 * Strip a Discord username's `#NNNN` discriminator if present.
 *
 * Bots created before 2023's username-system migration carry a 4-digit
 * discriminator; modern bots don't. Either form may appear in `client.user.tag`
 * depending on the bot's age.
 */
function stripDiscriminator(tag: string): string {
  return tag.replace(/\s{0,16}#\d{4}$/, '').trim();
}

/**
 * Derive the canonical webhook bot-suffix from the bot's Discord tag.
 *
 * @param botTag - Discord tag (e.g. `'Tzurot'`, `'Dev · Tzurot'`, or
 *   `'Tzurot#1234'`). When `null`/`undefined`/empty, returns an empty string —
 *   callers should treat that as "no suffix available, fall back to using the
 *   raw username."
 * @returns ` · BotName` (always uses the canonical separator) or `''`.
 */
export function deriveBotSuffix(botTag: string | null | undefined): string {
  if (botTag === null || botTag === undefined || botTag.length === 0) {
    return '';
  }
  const clean = stripDiscriminator(botTag);
  if (clean.length === 0) {
    return '';
  }

  // If the tag itself uses a separator (e.g. "Dev · Tzurot"), the right side
  // is the bot's display name; that's what gets appended to personality names.
  // Use `slice(1).join(sep)` rather than `[1]` so that compound separators
  // ("A · B · C") map to the full right-hand side ("B · C"). Production tags
  // are simple ("Rotzot · תשב", "Tzurot · שבת"), but the harder defense costs
  // nothing.
  let suffixCore: string;
  if (clean.includes(SEPARATOR_CURRENT)) {
    suffixCore = clean.split(SEPARATOR_CURRENT).slice(1).join(SEPARATOR_CURRENT).trim();
  } else if (clean.includes(SEPARATOR_LEGACY)) {
    suffixCore = clean.split(SEPARATOR_LEGACY).slice(1).join(SEPARATOR_LEGACY).trim();
  } else {
    suffixCore = clean;
  }

  return suffixCore.length > 0 ? `${SEPARATOR_CURRENT}${suffixCore}` : '';
}

/**
 * Strip the bot suffix off a webhook username to recover the personality
 * display name.
 *
 * Tries the canonical ` · BotName` suffix first; falls back to the legacy
 * ` | BotName` form so messages sent before the separator was switched are
 * still parseable.
 *
 * @returns The personality display name, or `null` if `webhookUsername`
 *   doesn't end with either suffix form. Returning `null` (rather than the
 *   raw username) lets callers distinguish "matched and stripped" from
 *   "username has an unknown shape, decide what to do" — useful for tier-3
 *   fallback logic.
 */
export function stripBotSuffix(webhookUsername: string, botSuffix: string): string | null {
  if (webhookUsername.length === 0 || botSuffix.length === 0) {
    return null;
  }

  if (webhookUsername.endsWith(botSuffix)) {
    return webhookUsername.slice(0, -botSuffix.length).trim();
  }

  // Legacy form: suffix produced by an older WebhookManager that used ` | `.
  // Build the legacy suffix from the current canonical form so callers don't
  // have to know about both separators.
  if (botSuffix.startsWith(SEPARATOR_CURRENT)) {
    const legacy = `${SEPARATOR_LEGACY}${botSuffix.slice(SEPARATOR_CURRENT.length)}`;
    if (webhookUsername.endsWith(legacy)) {
      return webhookUsername.slice(0, -legacy.length).trim();
    }
  }

  return null;
}

/**
 * Extract the personality display name from a webhook username, with the
 * raw username as fallback when no suffix matches. Convenience wrapper around
 * `stripBotSuffix` for sites that just want a "best-effort name" rather than
 * a strict match.
 */
export function extractPersonalityName(webhookUsername: string, botSuffix: string): string {
  const stripped = stripBotSuffix(webhookUsername, botSuffix);
  return stripped ?? webhookUsername;
}
