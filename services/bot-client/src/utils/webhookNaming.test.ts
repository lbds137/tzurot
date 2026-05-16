import { describe, it, expect } from 'vitest';
import { deriveBotSuffix, stripBotSuffix, extractPersonalityName } from './webhookNaming.js';

describe('deriveBotSuffix', () => {
  it('produces canonical " · BotName" from a simple tag', () => {
    expect(deriveBotSuffix('Tzurot')).toBe(' · Tzurot');
  });

  it('strips a legacy "#NNNN" discriminator before deriving the suffix', () => {
    expect(deriveBotSuffix('Tzurot#1234')).toBe(' · Tzurot');
  });

  it('uses the right-hand side when the tag already contains the canonical separator', () => {
    expect(deriveBotSuffix('Dev · Tzurot')).toBe(' · Tzurot');
  });

  it('uses the right-hand side when the tag contains the legacy separator', () => {
    expect(deriveBotSuffix('Dev | Tzurot')).toBe(' · Tzurot');
  });

  it('returns "" for null/undefined/empty input', () => {
    expect(deriveBotSuffix(null)).toBe('');
    expect(deriveBotSuffix(undefined)).toBe('');
    expect(deriveBotSuffix('')).toBe('');
  });

  it('returns "" when the tag is only whitespace or only a discriminator', () => {
    expect(deriveBotSuffix('   ')).toBe('');
    expect(deriveBotSuffix('#1234')).toBe('');
  });

  // Pin the production bot-tag shapes so a future tag change is caught here
  // before reaching prod. If the tags below ever change, update the assertions
  // alongside the rename.
  it('handles the dev bot tag', () => {
    expect(deriveBotSuffix('Rotzot · תשב#3778')).toBe(' · תשב');
  });

  it('handles the prod bot tag', () => {
    expect(deriveBotSuffix('Tzurot · שבת#9971')).toBe(' · שבת');
  });

  it('keeps the full right-hand side when a tag contains multiple separators', () => {
    // Production tags are simple ("Rotzot · תשב"), but a future compound
    // tag like "A · B · C" should yield " · B · C" — anything to the right
    // of the first separator is part of the bot's display name.
    expect(deriveBotSuffix('A · B · C')).toBe(' · B · C');
    expect(deriveBotSuffix('A | B | C')).toBe(' · B | C');
  });
});

describe('stripBotSuffix', () => {
  const suffix = ' · Tzurot';

  it('strips the canonical " · BotName" suffix', () => {
    expect(stripBotSuffix('Weaver · Tzurot', suffix)).toBe('Weaver');
  });

  it('strips the legacy " | BotName" suffix (back-compat for old messages)', () => {
    expect(stripBotSuffix('Weaver | Tzurot', suffix)).toBe('Weaver');
  });

  it('returns null when the username does not end with either suffix form', () => {
    expect(stripBotSuffix('Weaver', suffix)).toBeNull();
    expect(stripBotSuffix('Weaver · OtherBot', suffix)).toBeNull();
  });

  it('handles personality names containing the canonical separator inside the name', () => {
    // "A · B" is a valid personality displayName; only the trailing suffix should be stripped.
    expect(stripBotSuffix('A · B · Tzurot', suffix)).toBe('A · B');
  });

  it('handles personality names containing the legacy separator inside the name', () => {
    expect(stripBotSuffix('A | B · Tzurot', suffix)).toBe('A | B');
  });

  it('returns null when either argument is empty', () => {
    expect(stripBotSuffix('', suffix)).toBeNull();
    expect(stripBotSuffix('Weaver · Tzurot', '')).toBeNull();
  });

  it('trims whitespace introduced by the suffix boundary', () => {
    // The current separator already starts with a space, so slicing it produces
    // a trailing-space-free result — but defend against accidental double-space.
    expect(stripBotSuffix('Weaver  · Tzurot', suffix)).toBe('Weaver');
  });

  it('strips suffixes containing non-ASCII characters (Hebrew prod/dev bot names)', () => {
    expect(stripBotSuffix('Weaver · תשב', ' · תשב')).toBe('Weaver');
    expect(stripBotSuffix('Weaver · שבת', ' · שבת')).toBe('Weaver');
    // Legacy form back-compat with non-ASCII suffix
    expect(stripBotSuffix('Weaver | שבת', ' · שבת')).toBe('Weaver');
  });
});

describe('extractPersonalityName', () => {
  it('strips the suffix when present', () => {
    expect(extractPersonalityName('Weaver · Tzurot', ' · Tzurot')).toBe('Weaver');
  });

  it('falls back to the raw username when no suffix matches', () => {
    expect(extractPersonalityName('Weaver', ' · Tzurot')).toBe('Weaver');
  });

  it('falls back to the raw username when botSuffix is empty', () => {
    expect(extractPersonalityName('Weaver · Tzurot', '')).toBe('Weaver · Tzurot');
  });
});
