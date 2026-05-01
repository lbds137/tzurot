/**
 * Bot-authored audio classifier.
 *
 * Discord's `MessageSnapshot` (the representation of forwarded messages)
 * intentionally strips `author` and `webhookId` — only `attachments`,
 * `content`, `embeds`, etc. survive. So at the receive site for a forwarded
 * message we cannot ask "who originally sent this?" via the message metadata.
 *
 * The workaround: encode the bot identity into the attachment FILENAME at
 * upload time, and read it back at receive time. The filename of the form
 * `{clientId}-{slug}-{timestamp}.{ext}` carries:
 *
 * - `clientId` — Discord application ID of the bot that uploaded the file.
 *   The receive-side classifier matches against THIS bot's own clientId, so
 *   forwards from a different tzurot instance (dev vs prod, fork, sibling
 *   bot in the same server) are NOT classified as bot-authored — they get
 *   transcribed normally, treating each bot identity as separate.
 * - `slug` — the personality whose TTS produced the audio. Surfaced in the
 *   placeholder text for the LLM context so the persona reading the forward
 *   knows whose voice was forwarded.
 * - `timestamp` — base36-encoded `Date.now()`, prevents Discord's automatic
 *   `(1)` / `_1` filename suffixing when the same persona uploads multiple
 *   voice messages in quick succession.
 *
 * **Why this works under forwarding**: the `attachments` field IS preserved
 * on `MessageSnapshot`, including the `name` property. Discord doesn't
 * sanitize alphanumeric + hyphen filenames.
 *
 * **Adversarial caveat**: a user can deliberately upload a file matching
 * this pattern with the bot's own clientId to bypass STT. This is accepted
 * as out of scope per the project's "block lowest-effort extraction"
 * defense scope (see auto-memory feedback) — we're protecting against
 * accidental conversation loops, not motivated bypass.
 */

const FILENAME_PATTERN_BY_CLIENT_ID = new Map<string, RegExp>();

/**
 * Build (and memoize) the receive-side regex for a given client ID. Callers
 * always pass their own bot's clientId, so this cache stays bounded at one
 * entry in normal operation.
 */
function getFilenameRegex(clientId: string): RegExp {
  const cached = FILENAME_PATTERN_BY_CLIENT_ID.get(clientId);
  if (cached !== undefined) {
    return cached;
  }
  // Snowflake clientIds are pure digits (17-19 chars in practice). Embed
  // verbatim — they cannot contain regex metacharacters. Slug is kebab-case
  // ([a-z0-9]+(?:-[a-z0-9]+)*); timestamp is base36 ([a-z0-9]+); extension
  // is one of the three audio types we synthesize.
  const regex = new RegExp(
    `^${clientId}-(?<slug>[a-z0-9]+(?:-[a-z0-9]+)*)-[a-z0-9]+\\.(?:mp3|ogg|wav)$`
  );
  FILENAME_PATTERN_BY_CLIENT_ID.set(clientId, regex);
  return regex;
}

/**
 * Result of classifying a single attachment.
 */
export interface BotAudioClassification {
  /** True when the attachment filename matches `{clientId}-{slug}-{timestamp}.{ext}`. */
  isOwnBotAudio: boolean;
  /**
   * Personality slug extracted from the filename, when classification matched.
   * Useful for placeholder text in conversation context. Undefined on no match.
   */
  personalitySlug?: string;
}

/**
 * Build the TTS attachment filename for `personality` uploaded by `clientId`.
 * Send-side counterpart of `classifyBotAudio`.
 *
 * Caller is responsible for ensuring `clientId` is the live bot's identity
 * (typically `message.client.user?.id`). Slug is taken verbatim from the
 * personality record — the personality schema already enforces kebab-case.
 */
export function buildBotAudioFilename(options: {
  clientId: string;
  personalitySlug: string;
  extension: 'mp3' | 'ogg' | 'wav';
}): string {
  const { clientId, personalitySlug, extension } = options;
  const timestamp = Date.now().toString(36);
  return `${clientId}-${personalitySlug}-${timestamp}.${extension}`;
}

/**
 * Classify an attachment filename as either this bot's own audio or
 * something else. Returns the personality slug embedded in the filename
 * when matched.
 */
export function classifyBotAudio(
  attachmentName: string,
  myClientId: string
): BotAudioClassification {
  const match = getFilenameRegex(myClientId).exec(attachmentName);
  if (match === null) {
    return { isOwnBotAudio: false };
  }
  return {
    isOwnBotAudio: true,
    personalitySlug: match.groups?.slug,
  };
}
