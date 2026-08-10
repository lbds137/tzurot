import { describe, expect, it } from 'vitest';
import {
  isOwnPersonaVoice,
  OWN_VOICE_DESCRIPTION,
  redactOwnVoiceTranscript,
} from './ownVoiceGuard.js';

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

describe('OWN_VOICE_DESCRIPTION', () => {
  it('does not reuse the untranscribed-failure vocabulary', () => {
    // 'untranscribed' is reserved for a genuine STT failure; this text names
    // a deliberate skip, so it must read differently from a failure.
    expect(OWN_VOICE_DESCRIPTION.toLowerCase()).not.toContain('untranscribed');
    expect(OWN_VOICE_DESCRIPTION.toLowerCase()).not.toContain('fail');
  });
});

describe('redactOwnVoiceTranscript', () => {
  it('replaces a real transcript with the static description, keeping identity', () => {
    const result = redactOwnVoiceTranscript({
      kind: 'voice',
      filename: 'voice.ogg',
      contentType: 'audio/ogg',
      durationSeconds: 7,
      description: 'a stale transcript that must not survive',
    });

    expect(result).toEqual({
      kind: 'voice',
      filename: 'voice.ogg',
      contentType: 'audio/ogg',
      durationSeconds: 7,
      description: OWN_VOICE_DESCRIPTION,
    });
  });

  it('replaces an untranscribed-failure status with the static description', () => {
    const result = redactOwnVoiceTranscript({
      kind: 'voice',
      filename: 'voice.ogg',
      durationSeconds: 3,
      status: 'untranscribed',
    });

    expect(result).toEqual({
      kind: 'voice',
      filename: 'voice.ogg',
      contentType: undefined,
      durationSeconds: 3,
      description: OWN_VOICE_DESCRIPTION,
    });
  });
});
