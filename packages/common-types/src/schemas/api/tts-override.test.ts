/**
 * Tests for TTS override schemas.
 *
 * Pin the input-validation contract (UUIDs required, accepts only the
 * named fields) and the response-shape parse contract.
 */

import { describe, it, expect } from 'vitest';
import {
  SetTtsOverrideSchema,
  SetTtsDefaultConfigSchema,
  TtsOverrideSummarySchema,
  UserDefaultTtsConfigSchema,
  ListTtsOverridesResponseSchema,
  SetTtsOverrideResponseSchema,
  SetTtsDefaultConfigResponseSchema,
  ClearTtsDefaultConfigResponseSchema,
  DeleteTtsOverrideResponseSchema,
} from './tts-override.js';

const VALID_UUID_A = '11111111-1111-4111-8111-111111111111';
const VALID_UUID_B = '22222222-2222-4222-8222-222222222222';

describe('SetTtsOverrideSchema', () => {
  it('accepts valid UUIDs for personalityId + configId', () => {
    expect(
      SetTtsOverrideSchema.safeParse({
        personalityId: VALID_UUID_A,
        configId: VALID_UUID_B,
      }).success
    ).toBe(true);
  });

  it('rejects non-UUID personalityId', () => {
    expect(
      SetTtsOverrideSchema.safeParse({ personalityId: 'not-a-uuid', configId: VALID_UUID_B })
        .success
    ).toBe(false);
  });

  it('rejects non-UUID configId', () => {
    expect(
      SetTtsOverrideSchema.safeParse({ personalityId: VALID_UUID_A, configId: 'not-a-uuid' })
        .success
    ).toBe(false);
  });

  it('rejects missing personalityId', () => {
    expect(SetTtsOverrideSchema.safeParse({ configId: VALID_UUID_B }).success).toBe(false);
  });
});

describe('SetTtsDefaultConfigSchema', () => {
  it('accepts a valid configId UUID', () => {
    expect(SetTtsDefaultConfigSchema.safeParse({ configId: VALID_UUID_A }).success).toBe(true);
  });

  it('rejects non-UUID configId', () => {
    expect(SetTtsDefaultConfigSchema.safeParse({ configId: 'not-a-uuid' }).success).toBe(false);
  });
});

describe('TtsOverrideSummarySchema', () => {
  it('accepts a populated summary', () => {
    expect(
      TtsOverrideSummarySchema.safeParse({
        personalityId: 'p1',
        personalityName: 'Alice',
        configId: 'c1',
        configName: 'mistral-voxtral-mini',
      }).success
    ).toBe(true);
  });

  it('accepts null configId / configName (override exists but config unset)', () => {
    expect(
      TtsOverrideSummarySchema.safeParse({
        personalityId: 'p1',
        personalityName: 'Alice',
        configId: null,
        configName: null,
      }).success
    ).toBe(true);
  });
});

describe('UserDefaultTtsConfigSchema', () => {
  it('accepts both populated and null defaults', () => {
    expect(
      UserDefaultTtsConfigSchema.safeParse({ configId: 'c1', configName: 'kyutai-self-hosted' })
        .success
    ).toBe(true);
    expect(UserDefaultTtsConfigSchema.safeParse({ configId: null, configName: null }).success).toBe(
      true
    );
  });
});

describe('Response schemas', () => {
  it('ListTtsOverridesResponseSchema accepts an empty list', () => {
    expect(ListTtsOverridesResponseSchema.safeParse({ overrides: [] }).success).toBe(true);
  });

  it('SetTtsOverrideResponseSchema requires an override field', () => {
    expect(
      SetTtsOverrideResponseSchema.safeParse({
        override: {
          personalityId: 'p1',
          personalityName: 'Alice',
          configId: 'c1',
          configName: 'kyutai-self-hosted',
        },
      }).success
    ).toBe(true);
  });

  it('SetTtsDefaultConfigResponseSchema requires a default field', () => {
    expect(
      SetTtsDefaultConfigResponseSchema.safeParse({
        default: { configId: 'c1', configName: 'kyutai-self-hosted' },
      }).success
    ).toBe(true);
  });

  it('ClearTtsDefaultConfigResponseSchema accepts both wasSet shapes', () => {
    expect(ClearTtsDefaultConfigResponseSchema.safeParse({ deleted: true }).success).toBe(true);
    expect(
      ClearTtsDefaultConfigResponseSchema.safeParse({ deleted: true, wasSet: false }).success
    ).toBe(true);
  });

  it('DeleteTtsOverrideResponseSchema accepts both wasSet shapes', () => {
    expect(DeleteTtsOverrideResponseSchema.safeParse({ deleted: true }).success).toBe(true);
    expect(
      DeleteTtsOverrideResponseSchema.safeParse({ deleted: true, wasSet: false }).success
    ).toBe(true);
  });
});
