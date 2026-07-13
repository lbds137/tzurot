import { describe, it, expect } from 'vitest';
import {
  countContentWords,
  shouldFoldSearchQuery,
  FOLD_GATE_MAX_CONTENT_WORDS,
} from './queryFoldGate.js';

describe('countContentWords', () => {
  it('counts plain words with ≥2 alphanumerics', () => {
    expect(countContentWords('the quick brown fox')).toBe(4);
  });

  it('drops 1-char tokens and punctuation-only tokens', () => {
    // "I" and "a" are 1 alphanumeric; "..." and "—" carry none.
    expect(countContentWords('I a ... — ok')).toBe(1);
  });

  it('counts contractions via their alphanumeric residue', () => {
    // "I'm" → "Im" (2 alphanumerics) → counts.
    expect(countContentWords("I'm crying again")).toBe(3);
  });

  it('strips plain-text @/& tags as stored in history content', () => {
    expect(countContentWords('@Ha-Shem any other advice?')).toBe(3);
    expect(countContentWords('&Cold did you see my voice message?')).toBe(6);
  });

  it('strips raw Discord mention syntax (user/role/channel, animated flag)', () => {
    expect(countContentWords('<@123456789012345678> <@!42> <@&99> <#77> hello there')).toBe(2);
  });

  it('strips custom emoji, static and animated', () => {
    expect(
      countContentWords('<:anime_teehee:1108796741425319956> <a:kekw_animated:139> nice')
    ).toBe(1);
  });

  it('strips URLs but keeps surrounding text', () => {
    expect(countContentWords('look at this https://example.com/x?y=z lol')).toBe(4);
  });

  it('leaves residual tokens from multi-word display names (documented limitation)', () => {
    // "@Charlie" strips; "Morningstar" survives as one content word.
    expect(countContentWords('@Charlie Morningstar 😳')).toBe(1);
  });

  it('returns 0 for empty and tag-only messages', () => {
    expect(countContentWords('')).toBe(0);
    expect(countContentWords('@Emily')).toBe(0);
    expect(countContentWords('@Millie @Moxxie')).toBe(0);
  });
});

describe('shouldFoldSearchQuery', () => {
  it('folds content-poor reactive turns', () => {
    expect(shouldFoldSearchQuery('poke')).toBe(true);
    expect(shouldFoldSearchQuery('yes')).toBe(true);
    expect(shouldFoldSearchQuery('okay 🥺 😭')).toBe(true);
    expect(shouldFoldSearchQuery('@Emily')).toBe(true);
  });

  it('does not fold content-rich turns', () => {
    expect(
      shouldFoldSearchQuery(
        "ugh it's like that fucking xkcd meme about someone being wrong on the internet"
      )
    ).toBe(false);
  });

  it('does not fold short-text turns whose attachment description carries the content', () => {
    // The gate input is the UNFOLDED QUERY — message plus attachment text — so an
    // image post with a rich description is content-rich even if the typed text is short.
    const unfoldedQuery =
      'check this out This is a screenshot of a mobile chess application showing a puzzle in dark mode';
    expect(shouldFoldSearchQuery(unfoldedQuery)).toBe(false);
  });

  it('applies the threshold as a strict less-than at the boundary', () => {
    const fourWords = 'one two three four';
    const fiveWords = 'one two three four five';
    expect(countContentWords(fourWords)).toBe(4);
    expect(countContentWords(fiveWords)).toBe(5);
    expect(shouldFoldSearchQuery(fourWords, 5)).toBe(true);
    expect(shouldFoldSearchQuery(fiveWords, 5)).toBe(false);
  });

  it('honors a custom threshold', () => {
    expect(shouldFoldSearchQuery('one two three', 3)).toBe(false);
    expect(shouldFoldSearchQuery('one two', 3)).toBe(true);
  });

  it('pre-registered default is 5', () => {
    expect(FOLD_GATE_MAX_CONTENT_WORDS).toBe(5);
  });
});
