import { describe, expect, it } from 'vitest';
import { isOwnPersonaVoice } from './ownVoice.js';

describe('isOwnPersonaVoice', () => {
  it('is true for the literal "assistant" role', () => {
    expect(isOwnPersonaVoice('assistant')).toBe(true);
  });

  it.each([
    ['user' as const, 'a human author'],
    ['bot' as const, 'a non-persona bot/webhook'],
    ['system' as const, 'a role from a different vocabulary'],
    [undefined, 'no stamp at all (legacy rows)'],
  ])('is false for %s (%s)', (role, _reason) => {
    expect(isOwnPersonaVoice(role)).toBe(false);
  });
});
