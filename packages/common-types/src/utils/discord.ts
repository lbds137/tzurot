/**
 * Discord-specific utility functions
 */

import { BOT_FOOTER_PATTERNS, DISCORD_MENTIONS } from '../constants/discord.js';

/**
 * Leading-mention pattern — matches one mention (user, role, channel, or
 * text-rendered `@name`) at the start of a string with surrounding whitespace.
 * Used by `findLeadingMentionsEnd` to loop-skip stacked mentions.
 */
const LEADING_MENTIONS_RE = new RegExp(`^\\s*${DISCORD_MENTIONS.ANY_PATTERN}\\s*`);

const DISCORD_MAX_MESSAGE_LENGTH = 2000;

/** Default ellipsis for truncated text */
const DEFAULT_ELLIPSIS = '…';

/**
 * Truncates text to a maximum length, adding ellipsis if truncated.
 *
 * @param text - The text to truncate
 * @param maxLength - Maximum length including ellipsis (must be > ellipsis length)
 * @param ellipsis - String to append when truncated (default: '…')
 * @returns The truncated text, or original if within limit
 *
 * @example
 * truncateText('Hello World', 8) // 'Hello W…'
 * truncateText('Hi', 8) // 'Hi' (no truncation needed)
 * truncateText('Long text here', 10, '...') // 'Long te...'
 */
export function truncateText(
  text: string,
  maxLength: number,
  ellipsis: string = DEFAULT_ELLIPSIS
): string {
  // Defensive checks for text parameter
  if (!text || typeof text !== 'string') {
    return '';
  }

  // Defensive checks for ellipsis parameter
  if (typeof ellipsis !== 'string') {
    ellipsis = DEFAULT_ELLIPSIS;
  }

  // Defensive checks for maxLength parameter
  // Handle NaN, negative, and non-finite values
  if (!Number.isFinite(maxLength) || maxLength < 0) {
    return '';
  }

  // Ensure maxLength is an integer (floor it)
  maxLength = Math.floor(maxLength);

  if (maxLength === 0) {
    return '';
  }

  if (maxLength <= ellipsis.length) {
    // Can't fit anything useful, just return ellipsis truncated
    return ellipsis.slice(0, maxLength);
  }

  if (text.length <= maxLength) {
    return text;
  }

  // Truncate and add ellipsis
  return text.slice(0, maxLength - ellipsis.length) + ellipsis;
}

/** State for chunk accumulation during splitting */
interface ChunkState {
  chunks: string[];
  currentChunk: string;
}

/**
 * Force-splits a long word (like a URL) that exceeds maxLength
 * @internal
 */
function splitLongWord(word: string, maxLength: number): string[] {
  const wordChunks: string[] = [];
  // Floor of 1: a maxLength ≤ 10 would otherwise yield a non-positive step
  // and loop forever on an unsplittable word.
  const chunkSize = Math.max(1, maxLength - 10); // Leave room for "..."
  for (let i = 0; i < word.length; i += chunkSize) {
    wordChunks.push(word.slice(i, i + chunkSize) + '...');
  }
  return wordChunks;
}

/**
 * Processes words into chunks, handling long words by force-splitting
 * @internal
 */
function processWordsIntoChunks(words: string[], maxLength: number, state: ChunkState): void {
  for (const word of words) {
    if (word.length > maxLength) {
      // Flush current chunk before adding split word pieces
      if (state.currentChunk) {
        state.chunks.push(state.currentChunk.trim());
        state.currentChunk = '';
      }
      state.chunks.push(...splitLongWord(word, maxLength));
    } else if ((state.currentChunk + ' ' + word).length > maxLength) {
      state.chunks.push(state.currentChunk.trim());
      state.currentChunk = word;
    } else {
      state.currentChunk = state.currentChunk ? state.currentChunk + ' ' + word : word;
    }
  }
}

/**
 * Processes sentences into chunks, splitting on words if needed
 * @internal
 */
function processSentencesIntoChunks(
  sentences: string[],
  maxLength: number,
  state: ChunkState
): void {
  for (const sentence of sentences) {
    if (sentence.length > maxLength) {
      // Flush current chunk before word splitting
      if (state.currentChunk) {
        state.chunks.push(state.currentChunk.trim());
        state.currentChunk = '';
      }
      const words = sentence.split(/\s+/);
      processWordsIntoChunks(words, maxLength, state);
    } else if ((state.currentChunk + ' ' + sentence).length > maxLength) {
      state.chunks.push(state.currentChunk.trim());
      state.currentChunk = sentence;
    } else {
      state.currentChunk = state.currentChunk ? state.currentChunk + ' ' + sentence : sentence;
    }
  }
}

/**
 * Internal helper: splits text at natural boundaries (paragraphs, sentences, words)
 * This is an implementation detail - use splitMessage() for the public API
 * @internal
 */
function splitAtNaturalBoundaries(
  content: string,
  maxLength = DISCORD_MAX_MESSAGE_LENGTH
): string[] {
  if (content.length <= maxLength) {
    return [content];
  }

  const state: ChunkState = { chunks: [], currentChunk: '' };

  // First try to split on double newlines (paragraphs)
  const paragraphs = content.split(/\n\n+/);

  for (const paragraph of paragraphs) {
    if (paragraph.length > maxLength) {
      // Flush current chunk before processing long paragraph
      if (state.currentChunk) {
        state.chunks.push(state.currentChunk.trim());
        state.currentChunk = '';
      }
      // Split long paragraph on sentences
      const sentences = paragraph.split(/(?<=[.!?])\s+/);
      processSentencesIntoChunks(sentences, maxLength, state);
    } else if ((state.currentChunk + '\n\n' + paragraph).length > maxLength) {
      // Paragraph fits but would exceed limit with current chunk
      state.chunks.push(state.currentChunk.trim());
      state.currentChunk = paragraph;
    } else {
      // Add paragraph to current chunk
      state.currentChunk = state.currentChunk ? state.currentChunk + '\n\n' + paragraph : paragraph;
    }
  }

  // Don't forget the last chunk
  if (state.currentChunk) {
    state.chunks.push(state.currentChunk.trim());
  }

  return state.chunks.filter(chunk => chunk.length > 0);
}

/**
 * Splits a message for Discord's character limit while preserving code blocks
 *
 * This is the main entry point for message splitting. It:
 * 1. Preserves code blocks (``` ```) when possible
 * 2. Falls back to natural boundary splitting (paragraphs, sentences, words)
 * 3. Force-splits only when absolutely necessary
 *
 * @param content - The content to split
 * @param maxLength - Maximum length per chunk (default: Discord's 2000 char limit)
 */
/** Budget reserved on fallback re-splits for the markers rebalanceFences adds
 * (a closing fence plus a re-opening fence with a language tag; tags are
 * clamped to LANG_TAG_MAX so the budget always covers them). */
const FENCE_REBALANCE_HEADROOM = 32;
/** Longest language tag carried onto a continuation chunk (headroom math:
 * 3 close + newline + 3 open + tag + newline = 8 + tag ≤ 32 - margin). */
const LANG_TAG_MAX = 16;

export function splitMessage(content: string, maxLength = DISCORD_MAX_MESSAGE_LENGTH): string[] {
  // Defensive check: handle undefined/null/non-string input
  // Utility functions should be robust to bad input
  if (!content || typeof content !== 'string') {
    return [];
  }

  const codeBlockRegex = /```[\s\S]*?```/g;
  const codeBlocks = content.match(codeBlockRegex) ?? [];

  // No code blocks - use simple natural boundary splitting
  if (codeBlocks.length === 0) {
    return splitAtNaturalBoundaries(content, maxLength);
  }

  // Replace code blocks with placeholders to protect them during splitting
  let processedContent = content;
  const placeholders: string[] = [];

  codeBlocks.forEach((block, index) => {
    const placeholder = `__CODE_BLOCK_${index}__`;
    placeholders.push(placeholder);
    processedContent = processedContent.replace(block, placeholder);
  });

  // Split the content with placeholders
  const chunks = splitAtNaturalBoundaries(processedContent, maxLength);

  // Restore code blocks
  const restoredChunks = chunks.map(chunk => {
    let restoredChunk = chunk;
    codeBlocks.forEach((block, index) => {
      restoredChunk = restoredChunk.replace(`__CODE_BLOCK_${index}__`, block);
    });
    return restoredChunk;
  });

  // Check if any restored chunks exceed the limit (can happen if code block is large)
  // If so, re-split those chunks — the block WILL be cut, so the split runs
  // with headroom for the fence markers rebalanceFences adds, and the
  // rebalance pass re-closes/re-opens the fence at each boundary so every
  // chunk renders valid markdown on its own.
  const finalChunks: string[] = [];
  for (const chunk of restoredChunks) {
    if (chunk.length > maxLength) {
      // Rebalance ONLY this oversized chunk's own fragments — running the
      // parity heuristic across never-split chunks would let a stray
      // unpaired ``` elsewhere in the message inject phantom fences into
      // content the splitter never touched.
      const budget = Math.max(1, maxLength - FENCE_REBALANCE_HEADROOM);
      finalChunks.push(...rebalanceFences(splitAtNaturalBoundaries(chunk, budget)));
    } else {
      finalChunks.push(chunk);
    }
  }

  return finalChunks;
}

/**
 * Re-balance code fences across the FRAGMENTS of one force-split oversized
 * chunk. A fragment with an ODD number of ``` markers ends inside a fence
 * (the re-split cut it): close the fence at that fragment's end and re-open
 * it — carrying the language tag — at the start of the next, so no fragment
 * renders as an unterminated code block. Scope matters: the parity heuristic
 * is only sound within a group that genuinely contained a cut fence — it
 * must never run across untouched chunks, where a stray unpaired ``` would
 * read as an open fence and earn phantom markers.
 */
function rebalanceFences(chunks: string[]): string[] {
  const out: string[] = [];
  let openLang: string | null = null; // non-null = the previous chunk ended mid-fence
  for (const chunk of chunks) {
    let text: string = openLang !== null ? '```' + openLang + '\n' + chunk : chunk;
    if ((text.match(/```/g) ?? []).length % 2 === 1) {
      const lastOpen = text.lastIndexOf('```');
      openLang = (/^```([A-Za-z0-9+#.-]*)/.exec(text.slice(lastOpen))?.[1] ?? '').slice(
        0,
        LANG_TAG_MAX
      );
      text = text + '\n```';
    } else {
      openLang = null;
    }
    out.push(text);
  }
  return out;
}

/**
 * Strip bot-added footer lines from content.
 *
 * Only removes our specific footer patterns (model indicator, guest mode,
 * auto-response), not user `-#` formatting.
 *
 * @param content - Message content that may contain bot footers
 * @returns Content with bot footers removed
 */
export function stripBotFooters(content: string): string {
  let result = content;
  for (const pattern of Object.values(BOT_FOOTER_PATTERNS)) {
    // Reset lastIndex since patterns have 'g' flag
    pattern.lastIndex = 0;
    result = result.replace(pattern, '');
  }
  return result;
}

/**
 * Pattern for DM personality prefix added by DiscordResponseSender.
 * Format: **Display Name:** at the start of the message
 *
 * This prefix is added for DM messages so users can see which personality
 * is responding (since webhooks don't work in DMs). However, it should
 * NOT be stored in conversation history - it pollutes long-term memory.
 */
const DM_PREFIX_PATTERN = /^\*\*[^*]+:\*\*\s*/;

/**
 * Strip the DM personality prefix from message content.
 *
 * In DMs, we add "**Display Name:** " prefix for display purposes.
 * This should be stripped when syncing back to conversation history.
 *
 * @param content - Message content that may have DM prefix
 * @returns Content with DM prefix removed
 */
export function stripDmPrefix(content: string): string {
  return content.replace(DM_PREFIX_PATTERN, '');
}

/**
 * Capturing variant of {@link DM_PREFIX_PATTERN} — the same `**Name:** ` shape
 * but with the name captured so callers can recover the attribution.
 */
const DM_PREFIX_NAME_PATTERN = /^\*\*([^*]+):\*\*\s*/;

/**
 * Extract the display name from a bot-added `**Name:** ` prefix, or `null` if
 * the content has no such prefix.
 *
 * The same `channel.send("**Name:** …")` shape is used by two distinct bot
 * paths, so the recovered name means different things depending on the path —
 * the caller knows which it is from the message's author/registry status:
 *  - DM personality response → the name is the PERSONALITY's display name.
 *  - slash-command / chime-in relay echo → the name is the USER's display name.
 *
 * Apply ONLY to messages WE authored (same contract as
 * {@link normalizeMessageForContext}); a real user typing literal `**foo:** bar`
 * would otherwise be mis-attributed.
 */
export function extractMessagePrefixName(content: string): string | null {
  const match = DM_PREFIX_NAME_PATTERN.exec(content);
  return match !== null ? match[1].trim() : null;
}

/**
 * Canonical normalization for a message's content before it enters LLM context.
 *
 * This is the SINGLE source of truth for the content-cleaning every
 * context-building path must apply — the live Discord fetch
 * (`DiscordChannelFetcher`) and the DB-sync diff (`conversationSyncDiff`) both
 * route through it so the steps can't drift between paths (the drift between
 * those two is exactly what leaked footers / left relay prefixes in the model
 * context). Apply ONLY to messages WE authored (our bot user or our personality
 * webhooks); real users' `-#`/`**…:**` text is theirs and must be left intact.
 *
 * Steps, in order:
 * 1. Strip the relay / DM `**Name:** ` prefix the bot adds for slash-command
 *    and DM visibility (`stripDmPrefix`).
 * 2. Strip our `-#` subtext footers — model indicator, incognito/focus mode,
 *    auto-response, transcription attribution (`stripBotFooters`).
 *
 * Both sub-functions are pattern-specific (they match only our exact shapes),
 * so this never mangles legitimate user content even if mis-applied.
 */
export function normalizeMessageForContext(content: string): string {
  return stripBotFooters(stripDmPrefix(content));
}

/**
 * Find the first index of `s` that is NOT part of a leading Discord mention
 * or the whitespace surrounding one. Skips stacked mentions in a loop, so
 * `@Bot\n<@adminId> hello` returns the index of `h`.
 *
 * Handles all Discord mention formats uniformly:
 *   - User: `<@123>` or `<@!123>` (nickname-bang variant)
 *   - Role: `<@&123>`
 *   - Channel: `<#123>`
 *   - Text-rendered form: `@name` (any @-prefixed whitespace-delimited token)
 *
 * @param s - The string to scan
 * @param from - Starting index (default 0)
 * @returns The index of the first non-mention, non-leading-whitespace char
 *
 * @example
 * findLeadingMentionsEnd('@Bot hello')                 // 5
 * findLeadingMentionsEnd('<@123> <#456> hi')           // 14
 * findLeadingMentionsEnd('plain text')                 // 0
 */
export function findLeadingMentionsEnd(s: string, from = 0): number {
  let i = from;
  while (true) {
    const match = LEADING_MENTIONS_RE.exec(s.substring(i));
    if (match === null) {
      return i;
    }
    i += match[0].length;
  }
}

/**
 * Strip all leading Discord mentions (and surrounding whitespace) from `s`.
 * See {@link findLeadingMentionsEnd} for the mention formats recognized.
 *
 * @example
 * stripLeadingMentions('@Bot hello')        // 'hello'
 * stripLeadingMentions('<@123> <@456> hi')  // 'hi'
 * stripLeadingMentions('plain text')        // 'plain text'
 */
export function stripLeadingMentions(s: string): string {
  return s.substring(findLeadingMentionsEnd(s));
}
