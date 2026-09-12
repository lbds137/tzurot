import { describe, it, expect } from 'vitest';
import {
  SetPersonalityDefaultConfigRequestSchema,
  SetPersonalityDefaultConfigResponseSchema,
  ClearPersonalityDefaultConfigResponseSchema,
} from './personalityDefaultConfig.js';

describe('SetPersonalityDefaultConfigRequestSchema', () => {
  const validConfigId = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

  it('accepts a valid uuid configId', () => {
    expect(
      SetPersonalityDefaultConfigRequestSchema.safeParse({ configId: validConfigId }).success
    ).toBe(true);
  });

  it('rejects a missing configId', () => {
    expect(SetPersonalityDefaultConfigRequestSchema.safeParse({}).success).toBe(false);
  });

  it('rejects a non-uuid configId', () => {
    expect(
      SetPersonalityDefaultConfigRequestSchema.safeParse({ configId: 'not-a-uuid' }).success
    ).toBe(false);
  });

  it('rejects an unknown extra key (.strict())', () => {
    expect(
      SetPersonalityDefaultConfigRequestSchema.safeParse({
        configId: validConfigId,
        extra: 'nope',
      }).success
    ).toBe(false);
  });
});

describe('SetPersonalityDefaultConfigResponseSchema', () => {
  it('accepts a valid text-slot response', () => {
    expect(
      SetPersonalityDefaultConfigResponseSchema.safeParse({
        slot: 'text',
        config: { id: 'cfg-1', name: 'My Config', model: 'anthropic/claude-sonnet-4' },
      }).success
    ).toBe(true);
  });

  it('accepts a valid vision-slot response', () => {
    expect(
      SetPersonalityDefaultConfigResponseSchema.safeParse({
        slot: 'vision',
        config: { id: 'cfg-2', name: 'Vision Config', model: 'google/gemini-2.5-flash' },
      }).success
    ).toBe(true);
  });

  it('rejects an unknown slot value', () => {
    expect(
      SetPersonalityDefaultConfigResponseSchema.safeParse({
        slot: 'audio',
        config: { id: 'cfg-1', name: 'My Config', model: 'anthropic/claude-sonnet-4' },
      }).success
    ).toBe(false);
  });
});

describe('ClearPersonalityDefaultConfigResponseSchema', () => {
  it('accepts the success shape', () => {
    expect(ClearPersonalityDefaultConfigResponseSchema.safeParse({ success: true }).success).toBe(
      true
    );
  });

  it('rejects success: false', () => {
    expect(ClearPersonalityDefaultConfigResponseSchema.safeParse({ success: false }).success).toBe(
      false
    );
  });
});
