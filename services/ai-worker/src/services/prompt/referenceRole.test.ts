import { describe, it, expect } from 'vitest';
import { deriveRefRole } from './referenceRole.js';

describe('deriveRefRole name matching (fallback path)', () => {
  it('matches when the author name is prefixed by the active personality name', () => {
    // Webhook usernames are `${displayName}${botSuffix}`, so the personality name is a prefix.
    expect(deriveRefRole(undefined, 'Lilith ▽', 'Lilith')).toBe('assistant');
  });

  it('is case-insensitive', () => {
    expect(deriveRefRole(undefined, 'lilith ▽', 'Lilith')).toBe('assistant');
  });

  it('does not match an unrelated author', () => {
    expect(deriveRefRole(undefined, 'Some Human', 'Lilith')).toBe('user');
  });

  it('resolves a non-persona author to user even with a personality set', () => {
    expect(deriveRefRole(undefined, 'Some Human', 'Lilith', new Set(['Lila', 'Lilith']))).toBe(
      'user'
    );
  });
});

describe('deriveRefRole', () => {
  it('resolves a stamped assistant to assistant when the author is the responding persona', () => {
    // The stamp says "one of our personas" — the render-time split decides WHICH.
    expect(deriveRefRole('assistant', 'Lilith ▽', 'Lilith')).toBe('assistant');
  });

  it('demotes a stamped assistant to character on a positive sibling match', () => {
    // A sibling's line must never render as the responding persona's own words.
    expect(deriveRefRole('assistant', 'Ha-Shem ▽', 'Yeshua', new Set(['Ha-Shem', 'Yeshua']))).toBe(
      'character'
    );
  });

  it('keeps a stamped assistant WITHOUT a positive sibling match (conservative default)', () => {
    // Name vocabularies differ across call sites (stored name vs displayName), so
    // an unmatched author keeps assistant rather than misfiring on the persona's
    // own line — demotion requires positive evidence.
    expect(deriveRefRole('assistant', 'Ha-Shem ▽', 'Yeshua')).toBe('assistant');
  });

  it("does not demote the persona's own line when the set carries its stored-name variant", () => {
    // Stored rows carry personality.name ("Yeshua") while the live path matches
    // displayName ("Yeshua ben Yosef") — the name-variant entry must read as SELF.
    expect(
      deriveRefRole(
        'assistant',
        'Yeshua ▽',
        'Yeshua ben Yosef',
        new Set(['Yeshua', 'Ha-Shem', 'Yeshua ben Yosef'])
      )
    ).toBe('assistant');
  });

  it('fallback: own line under a stored-name variant resolves to assistant, not character', () => {
    // Mirror of the stamped self-variant pin with NO stamp — the fallback must
    // route through the same self-variant guard (round-2 review catch: it
    // previously matched the bare set entry and misread the persona's own line).
    expect(
      deriveRefRole(
        undefined,
        'Yeshua ▽',
        'Yeshua ben Yosef',
        new Set(['Yeshua', 'Ha-Shem', 'Yeshua ben Yosef'])
      )
    ).toBe('assistant');
  });

  it('returns the stamped authorRole verbatim when present (user)', () => {
    expect(deriveRefRole('user', 'Lilith', 'Lilith')).toBe('user');
  });

  it('returns the stamped authorRole verbatim when present (bot)', () => {
    // Even though name-matching has no `bot` concept, an explicit bot role is honored.
    expect(deriveRefRole('bot', 'Some Bot', 'Lilith')).toBe('bot');
  });

  it('falls back to assistant when authorRole is absent and the name matches the personality', () => {
    // The deployment-transition / pre-classifier case: a reference produced before
    // authorRole is stamped (old bot-client mid-rolling-deploy, or pre-classifier
    // stored history) still resolves the personality's own message to assistant.
    expect(deriveRefRole(undefined, 'Lilith ▽', 'Lilith')).toBe('assistant');
  });

  it('falls back to character for a sibling persona when allPersonalityNames is provided', () => {
    expect(deriveRefRole(undefined, 'Lila ▽', 'Lilith', new Set(['Lila', 'Lilith']))).toBe(
      'character'
    );
  });

  it('falls back to user when authorRole is absent and the name does not match', () => {
    expect(deriveRefRole(undefined, 'Some Human', 'Lilith')).toBe('user');
  });

  it('falls back to user for a sibling persona when allPersonalityNames is omitted', () => {
    // Documented degraded behavior: without the full personality set, only the active
    // personality's own messages resolve to assistant in the fallback window.
    expect(deriveRefRole(undefined, 'Lila ▽', 'Lilith')).toBe('user');
  });
});
