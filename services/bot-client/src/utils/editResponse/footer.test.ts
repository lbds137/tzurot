import { describe, it, expect } from 'vitest';
import { BOT_FOOTER_TEXT, buildModelFooterText } from '@tzurot/common-types/constants/discord';
import { extractTrailingFooter } from './footer.js';

const MODEL_LINE = `-# ${buildModelFooterText('anthropic/claude-x', 'https://openrouter.ai/anthropic/claude-x', {})}`;

describe('extractTrailingFooter', () => {
  it('returns an empty string when the message ends in no footer', () => {
    expect(extractTrailingFooter('Just a reply.\nSecond line.')).toBe('');
  });

  it('returns the model footer with its leading newline', () => {
    expect(extractTrailingFooter(`Reply text\n${MODEL_LINE}`)).toBe(`\n${MODEL_LINE}`);
  });

  it('returns a multi-line footer block in order', () => {
    const block = `${MODEL_LINE}\n-# ${BOT_FOOTER_TEXT.FRESH_MODE}\n-# ${BOT_FOOTER_TEXT.INCOGNITO_MODE}`;

    expect(extractTrailingFooter(`Reply\n${block}`)).toBe(`\n${block}`);
  });

  it('stops at the first non-footer line walking up from the end', () => {
    const content = `Reply\n-# ${BOT_FOOTER_TEXT.FRESH_MODE}\nmiddle prose\n-# ${BOT_FOOTER_TEXT.INCOGNITO_MODE}`;

    expect(extractTrailingFooter(content)).toBe(`\n-# ${BOT_FOOTER_TEXT.INCOGNITO_MODE}`);
  });

  it('leaves a footer-looking line in the middle of the text alone', () => {
    expect(extractTrailingFooter(`-# ${BOT_FOOTER_TEXT.FRESH_MODE}\nmore text`)).toBe('');
  });

  it('does not treat a user small-text line as a footer', () => {
    expect(extractTrailingFooter('Reply\n-# just a note')).toBe('');
  });

  it('walks past a trailing TTS notice line and drops it from the footer', () => {
    const content = `Reply\n${MODEL_LINE}\n-# ${BOT_FOOTER_TEXT.FRESH_MODE}\n-# ⚠️ Mistral skipped: reference audio too long`;

    expect(extractTrailingFooter(content)).toBe(
      `\n${MODEL_LINE}\n-# ${BOT_FOOTER_TEXT.FRESH_MODE}`
    );
  });

  it('returns no footer when the only trailing lines are TTS notices', () => {
    expect(extractTrailingFooter('Reply\n-# ⚠️ a notice')).toBe('');
  });

  it("drops a reply's own trailing `-# ⚠️` line as a notice (accepted residue)", () => {
    // Notice detection is prefix-only, so a reply whose own last content line
    // starts with the notice prefix is dropped like a TTS notice and the walk
    // continues past it to the footer above.
    const content = `Reply\n-# ⚠️ written by the model\n${MODEL_LINE}`;

    expect(extractTrailingFooter(content)).toBe(`\n${MODEL_LINE}`);
  });

  it('adds the leading newline for a footer-only message', () => {
    expect(extractTrailingFooter(MODEL_LINE)).toBe(`\n${MODEL_LINE}`);
  });

  it('carries a reply whose own last line matches a footer pattern as footer', () => {
    // Pins current behaviour: the extractor cannot tell a model-written footer-shaped
    // last line from the bot's, so it is preserved as footer rather than edited.
    expect(extractTrailingFooter(`Reply\n-# ${BOT_FOOTER_TEXT.FRESH_MODE}`)).toBe(
      `\n-# ${BOT_FOOTER_TEXT.FRESH_MODE}`
    );
  });

  it('gives the same answer on repeated calls (no shared global-regex state)', () => {
    const content = `Reply\n${MODEL_LINE}`;

    expect(extractTrailingFooter(content)).toBe(extractTrailingFooter(content));
  });
});
