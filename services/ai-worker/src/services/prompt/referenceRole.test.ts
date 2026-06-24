import { describe, it, expect } from 'vitest';
import { isAuthorAssistant, deriveRefRole } from './referenceRole.js';

describe('isAuthorAssistant', () => {
  it('matches when the author name is prefixed by the active personality name', () => {
    // Webhook usernames are `${displayName}${botSuffix}`, so the personality name is a prefix.
    expect(isAuthorAssistant('Lilith ▽', 'Lilith')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isAuthorAssistant('lilith ▽', 'Lilith')).toBe(true);
  });

  it('does not match an unrelated author', () => {
    expect(isAuthorAssistant('Some Human', 'Lilith')).toBe(false);
  });

  it('matches a sibling persona via allPersonalityNames', () => {
    expect(isAuthorAssistant('Lila ▽', 'Lilith', new Set(['Lila', 'Lilith']))).toBe(true);
  });

  it('returns false for a non-persona author even with a personality set', () => {
    expect(isAuthorAssistant('Some Human', 'Lilith', new Set(['Lila', 'Lilith']))).toBe(false);
  });
});

describe('deriveRefRole', () => {
  it('returns the stamped authorRole verbatim when present (assistant)', () => {
    // The classifier is authoritative — name-matching is never consulted when set.
    expect(deriveRefRole('assistant', 'irrelevant', 'Lilith')).toBe('assistant');
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

  it('falls back to assistant for a sibling persona when allPersonalityNames is provided', () => {
    expect(deriveRefRole(undefined, 'Lila ▽', 'Lilith', new Set(['Lila', 'Lilith']))).toBe(
      'assistant'
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
