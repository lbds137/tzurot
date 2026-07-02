/**
 * TTS Config API Contract Tests
 *
 * Verifies the contract for TTS config CRUD endpoints. Mirrors
 * `llm-config.test.ts` shape but scoped to TTS-specific concerns:
 * provider validation, modelId nullability, and the absence of
 * sampling/memory/context fields that LLM has.
 */

import { describe, it, expect } from 'vitest';
import {
  TtsProviderIdSchema,
  TtsAdvancedParamsSchema,
  TtsConfigCreateSchema,
  TtsConfigUpdateSchema,
  TtsConfigSummarySchema,
  ListTtsConfigsResponseSchema,
  CreateTtsConfigResponseSchema,
  DeleteTtsConfigResponseSchema,
  GetTtsConfigResponseSchema,
  UpdateTtsConfigResponseSchema,
  SetDefaultTtsConfigResponseSchema,
  TTS_CONFIG_LIST_SELECT,
  TTS_CONFIG_DETAIL_SELECT,
  TTS_CONFIG_DEFAULTS,
} from './tts-config.js';

describe('TtsProviderIdSchema', () => {
  it('accepts the three known provider ids', () => {
    expect(TtsProviderIdSchema.safeParse('self-hosted').success).toBe(true);
    expect(TtsProviderIdSchema.safeParse('elevenlabs').success).toBe(true);
    expect(TtsProviderIdSchema.safeParse('mistral').success).toBe(true);
  });

  it('rejects unknown provider ids (refines via isTtsProviderId)', () => {
    expect(TtsProviderIdSchema.safeParse('openai').success).toBe(false);
    expect(TtsProviderIdSchema.safeParse('').success).toBe(false);
    expect(TtsProviderIdSchema.safeParse('SELF-HOSTED').success).toBe(false); // case-sensitive
  });
});

describe('TtsAdvancedParamsSchema', () => {
  it('accepts an empty object', () => {
    expect(TtsAdvancedParamsSchema.safeParse({}).success).toBe(true);
  });

  it('accepts arbitrary string keys with unknown values', () => {
    const result = TtsAdvancedParamsSchema.safeParse({
      stability: 0.5,
      similarity_boost: 0.75,
      voice_settings: { speed: 1.2 },
      arbitrary_key: 'arbitrary value',
    });
    expect(result.success).toBe(true);
  });

  it('rejects non-object input', () => {
    expect(TtsAdvancedParamsSchema.safeParse('string').success).toBe(false);
    expect(TtsAdvancedParamsSchema.safeParse(42).success).toBe(false);
    expect(TtsAdvancedParamsSchema.safeParse(null).success).toBe(false);
  });
});

describe('TtsConfigCreateSchema', () => {
  const validInput = {
    name: 'My Mistral Voice',
    provider: 'mistral' as const,
    description: 'For my main personality',
    modelId: 'voxtral-mini-tts-2603',
    advancedParameters: { speed: 1.0 },
  };

  it('accepts a complete valid input', () => {
    expect(TtsConfigCreateSchema.safeParse(validInput).success).toBe(true);
  });

  it('requires name', () => {
    const result = TtsConfigCreateSchema.safeParse({ ...validInput, name: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some(i => i.path.includes('name'))).toBe(true);
    }
  });

  it('requires provider and rejects unknown values', () => {
    expect(TtsConfigCreateSchema.safeParse({ ...validInput, provider: undefined }).success).toBe(
      false
    );
    expect(TtsConfigCreateSchema.safeParse({ ...validInput, provider: 'openai' }).success).toBe(
      false
    );
  });

  it('allows null modelId (for self-hosted)', () => {
    const result = TtsConfigCreateSchema.safeParse({
      ...validInput,
      provider: 'self-hosted',
      modelId: null,
    });
    expect(result.success).toBe(true);
  });

  it('allows omitted modelId', () => {
    const { modelId: _omitted, ...withoutModelId } = validInput;
    const result = TtsConfigCreateSchema.safeParse(withoutModelId);
    expect(result.success).toBe(true);
  });

  it('rejects names longer than 100 characters', () => {
    const result = TtsConfigCreateSchema.safeParse({ ...validInput, name: 'x'.repeat(101) });
    expect(result.success).toBe(false);
  });

  it('accepts autoSuffixOnCollision flag', () => {
    expect(
      TtsConfigCreateSchema.safeParse({ ...validInput, autoSuffixOnCollision: true }).success
    ).toBe(true);
    expect(
      TtsConfigCreateSchema.safeParse({ ...validInput, autoSuffixOnCollision: false }).success
    ).toBe(true);
  });
});

describe('TtsConfigUpdateSchema', () => {
  it('accepts an empty update (all fields optional)', () => {
    expect(TtsConfigUpdateSchema.safeParse({}).success).toBe(true);
  });

  it('accepts a single-field update', () => {
    expect(TtsConfigUpdateSchema.safeParse({ name: 'New Name' }).success).toBe(true);
  });

  it('coerces empty strings on optional fields to undefined (preserves existing value)', () => {
    const result = TtsConfigUpdateSchema.parse({ name: '', provider: '' });
    // optionalString transforms '' → undefined, so the parsed object is empty
    expect(result.name).toBeUndefined();
    expect(result.provider).toBeUndefined();
  });

  it('coerces empty strings on nullable fields to null (clears the value)', () => {
    const result = TtsConfigUpdateSchema.parse({ description: '', modelId: '' });
    expect(result.description).toBeNull();
    expect(result.modelId).toBeNull();
  });

  it('accepts isGlobal toggle', () => {
    expect(TtsConfigUpdateSchema.safeParse({ isGlobal: true }).success).toBe(true);
    expect(TtsConfigUpdateSchema.safeParse({ isGlobal: false }).success).toBe(true);
  });

  it('does NOT validate provider against the strict provider id set on update', () => {
    // Update uses optionalString(40) for backwards-compat with empty-string
    // semantics. A bogus provider value would land here but the service
    // layer normalizes / validates against the runtime guard before write.
    expect(TtsConfigUpdateSchema.safeParse({ provider: 'openai' }).success).toBe(true);
  });
});

describe('TtsConfigSummarySchema', () => {
  const validSummary = {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Mistral Voxtral',
    description: 'Default Mistral voice',
    provider: 'mistral' as const,
    modelId: 'voxtral-mini-tts-latest',
    isGlobal: true,
    isDefault: true,
    isOwned: false,
    permissions: { canEdit: false, canDelete: false },
  };

  it('validates a complete summary', () => {
    expect(TtsConfigSummarySchema.safeParse(validSummary).success).toBe(true);
  });

  it('rejects non-UUID ids', () => {
    expect(TtsConfigSummarySchema.safeParse({ ...validSummary, id: 'not-a-uuid' }).success).toBe(
      false
    );
  });

  it('allows null modelId', () => {
    expect(TtsConfigSummarySchema.safeParse({ ...validSummary, modelId: null }).success).toBe(true);
  });

  it('rejects unknown provider', () => {
    expect(TtsConfigSummarySchema.safeParse({ ...validSummary, provider: 'openai' }).success).toBe(
      false
    );
  });
});

describe('Response schemas', () => {
  const summary = {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'x',
    description: null,
    provider: 'self-hosted' as const,
    modelId: null,
    isGlobal: true,
    isDefault: false,
    isOwned: false,
    permissions: { canEdit: false, canDelete: false },
  };

  it('ListTtsConfigsResponseSchema accepts an array of summaries', () => {
    expect(ListTtsConfigsResponseSchema.safeParse({ configs: [summary] }).success).toBe(true);
    expect(ListTtsConfigsResponseSchema.safeParse({ configs: [] }).success).toBe(true);
  });

  it('CreateTtsConfigResponseSchema wraps a single summary', () => {
    expect(CreateTtsConfigResponseSchema.safeParse({ config: summary }).success).toBe(true);
  });

  it('DeleteTtsConfigResponseSchema requires deleted: true (literal)', () => {
    expect(DeleteTtsConfigResponseSchema.safeParse({ deleted: true }).success).toBe(true);
    expect(DeleteTtsConfigResponseSchema.safeParse({ deleted: false }).success).toBe(false);
  });
});

describe('SELECT constants and DEFAULTS', () => {
  it('TTS_CONFIG_LIST_SELECT names the expected fields', () => {
    // isDefault/isFreeDefault deliberately absent: the stale columns are not
    // selected — default-ness derives from the AdminSettings TTS pointers.
    expect(TTS_CONFIG_LIST_SELECT).toEqual({
      id: true,
      name: true,
      description: true,
      provider: true,
      modelId: true,
      isGlobal: true,
      ownerId: true,
    });
  });

  it('TTS_CONFIG_DETAIL_SELECT extends LIST with advancedParameters', () => {
    expect(TTS_CONFIG_DETAIL_SELECT).toMatchObject({
      ...TTS_CONFIG_LIST_SELECT,
      advancedParameters: true,
    });
  });

  it('TTS_CONFIG_DEFAULTS provides a sensible self-hosted default', () => {
    expect(TTS_CONFIG_DEFAULTS.provider).toBe('self-hosted');
  });
});

describe('GetTtsConfigResponseSchema and UpdateTtsConfigResponseSchema', () => {
  // Matches TtsConfigSummarySchema actual fields (id, name, description,
  // provider, modelId, isGlobal, isDefault, isOwned, permissions).
  const validConfig = {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'cfg',
    description: null,
    provider: 'self-hosted' as const,
    modelId: 'kokoro',
    isGlobal: true,
    isDefault: false,
    isOwned: false,
    permissions: { canEdit: false, canDelete: false },
  };

  it('GetTtsConfigResponseSchema accepts a single-config wrapper', () => {
    expect(GetTtsConfigResponseSchema.safeParse({ config: validConfig }).success).toBe(true);
  });

  it('UpdateTtsConfigResponseSchema mirrors the same shape', () => {
    expect(UpdateTtsConfigResponseSchema.safeParse({ config: validConfig }).success).toBe(true);
  });
});

describe('SetDefaultTtsConfigResponseSchema', () => {
  it('accepts { success, configName }', () => {
    expect(
      SetDefaultTtsConfigResponseSchema.safeParse({
        success: true,
        configName: 'kokoro-default',
      }).success
    ).toBe(true);
  });
});
