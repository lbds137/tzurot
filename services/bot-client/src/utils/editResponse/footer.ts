/**
 * Footer recovery for an edited reply.
 *
 * The stored reply text is undecorated; the footer the sender appended (model
 * line, mode badges) exists only on the live Discord message. An edit must
 * carry it forward, so it is read back off the live last chunk.
 */

import { BOT_FOOTER_PATTERNS } from '@tzurot/common-types/constants/discord';

/**
 * Whole-line matchers built from `BOT_FOOTER_PATTERNS`. The shared patterns are
 * global (`/g`), so calling `.test` on them directly mutates `lastIndex`; these
 * are fresh non-global copies, anchored so a line only counts when the entire
 * line is a footer.
 */
const FOOTER_LINE_MATCHERS: readonly RegExp[] = Object.values(BOT_FOOTER_PATTERNS).map(
  pattern => new RegExp(`^(?:${pattern.source})$`, pattern.flags.replace('g', ''))
);

function isFooterLine(line: string): boolean {
  return FOOTER_LINE_MATCHERS.some(matcher => matcher.test(line));
}

/**
 * Prefix of the owner-only TTS notice lines the sender appends last
 * (`DiscordResponseSender.buildOwnerOnlyTtsNoticeLines`). The notice text is
 * free-form, so only the prefix identifies it.
 */
const TTS_NOTICE_PREFIX = '-# ⚠️ ';

function isTtsNoticeLine(line: string): boolean {
  return line.startsWith(TTS_NOTICE_PREFIX);
}

/**
 * The trailing block of footer lines of a live message, including the leading
 * newline the sender puts before it; `''` when the message ends in no footer.
 *
 * A footer-only message (the sender emits one when the footer overflowed the
 * last chunk) yields the whole message with a leading newline added, so the
 * result can be re-appended to any text the same way.
 *
 * TTS notice lines are walked past but dropped from the result: they describe
 * the audio of the original send, and an edit removes that audio.
 */
export function extractTrailingFooter(content: string): string {
  const lines = content.split('\n');
  let start = lines.length;
  while (start > 0 && (isFooterLine(lines[start - 1]) || isTtsNoticeLine(lines[start - 1]))) {
    start--;
  }
  const kept = lines.slice(start).filter(line => !isTtsNoticeLine(line));
  return kept.length === 0 ? '' : `\n${kept.join('\n')}`;
}
