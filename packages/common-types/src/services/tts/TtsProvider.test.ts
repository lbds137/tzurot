import { describe, it, expect } from 'vitest';
import {
  buildPreparedInlineAudio,
  buildPreparedVoiceId,
  isSelfHostedTtsProvider,
  isTtsProviderId,
  type PreparedTts,
} from './TtsProvider.js';

describe('isTtsProviderId', () => {
  it('accepts known provider ids', () => {
    expect(isTtsProviderId('self-hosted')).toBe(true);
    expect(isTtsProviderId('elevenlabs')).toBe(true);
    expect(isTtsProviderId('mistral')).toBe(true);
  });

  it('rejects unknown strings', () => {
    expect(isTtsProviderId('openrouter')).toBe(false);
    expect(isTtsProviderId('')).toBe(false);
    expect(isTtsProviderId('Mistral')).toBe(false); // case-sensitive
  });
});

describe('isSelfHostedTtsProvider', () => {
  it('is true for self-hosted', () => {
    expect(isSelfHostedTtsProvider('self-hosted')).toBe(true);
  });

  it('is false for BYOK providers', () => {
    expect(isSelfHostedTtsProvider('elevenlabs')).toBe(false);
    expect(isSelfHostedTtsProvider('mistral')).toBe(false);
  });

  it('is false for unknown strings (no narrowing prerequisite)', () => {
    expect(isSelfHostedTtsProvider('openrouter')).toBe(false);
    expect(isSelfHostedTtsProvider('')).toBe(false);
    expect(isSelfHostedTtsProvider('Self-Hosted')).toBe(false); // case-sensitive
  });
});

describe('PreparedTts builders', () => {
  it('buildPreparedVoiceId produces a stateful handle', () => {
    const handle: PreparedTts = buildPreparedVoiceId('elevenlabs', 'voice-abc');
    expect(handle._brand).toBe('prepared');
    expect(handle.kind).toBe('voiceId');
    if (handle.kind === 'voiceId') {
      expect(handle.id).toBe('voice-abc');
      expect(handle.provider).toBe('elevenlabs');
    }
  });

  it('buildPreparedInlineAudio produces a stateless handle', () => {
    const buffer = Buffer.from([0x52, 0x49, 0x46, 0x46]); // "RIFF"
    const handle: PreparedTts = buildPreparedInlineAudio('mistral', buffer, 'audio/wav');
    expect(handle._brand).toBe('prepared');
    expect(handle.kind).toBe('inlineAudio');
    if (handle.kind === 'inlineAudio') {
      expect(handle.buffer).toBe(buffer);
      expect(handle.mimeType).toBe('audio/wav');
      expect(handle.provider).toBe('mistral');
    }
  });

  it('discriminated union narrowing works on handle.kind', () => {
    const stateful = buildPreparedVoiceId('mistral', 'v1');
    const stateless = buildPreparedInlineAudio('elevenlabs', Buffer.from([0]), 'audio/mp3');

    // Each branch should be type-narrowable
    if (stateful.kind === 'voiceId') {
      expect(typeof stateful.id).toBe('string');
    }
    if (stateless.kind === 'inlineAudio') {
      expect(stateless.buffer).toBeInstanceOf(Buffer);
    }
  });
});
