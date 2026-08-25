import { describe, expect, it } from 'vitest';
import {
  ExportLlmConfigRowSchema,
  ExportTtsConfigRowSchema,
  ExportUserDefaultsSchema,
  ExportUserPersonaHistoryConfigRowSchema,
  ExportUserPersonalityConfigRowSchema,
} from './accountExportConfigSchemas.js';

describe('accountExportConfigSchemas', () => {
  it('parses a valid LLM config row', () => {
    const result = ExportLlmConfigRowSchema.safeParse({
      id: 'llm-1',
      name: 'My Config',
      description: null,
      ownerId: 'user-1',
      isGlobal: false,
      provider: 'openrouter',
      model: 'anthropic/claude-sonnet-4',
      advancedParameters: null,
      contextWindowTokens: 131072,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an LLM config row with an unrecognized key (drift guard)', () => {
    const result = ExportLlmConfigRowSchema.safeParse({
      id: 'llm-1',
      name: 'My Config',
      description: null,
      ownerId: 'user-1',
      isGlobal: false,
      provider: 'openrouter',
      model: 'anthropic/claude-sonnet-4',
      advancedParameters: null,
      contextWindowTokens: 131072,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      newField: 'unexpected',
    });
    expect(result.success).toBe(false);
  });

  it('parses a valid TTS config row', () => {
    const result = ExportTtsConfigRowSchema.safeParse({
      id: 'tts-1',
      name: 'My Voice',
      description: null,
      ownerId: 'user-1',
      isGlobal: false,
      isDefault: false,
      isFreeDefault: false,
      provider: 'self-hosted',
      modelId: null,
      advancedParameters: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('parses a valid user-personality config row', () => {
    const result = ExportUserPersonalityConfigRowSchema.safeParse({
      id: 'upc-1',
      userId: 'user-1',
      personalityId: 'char-1',
      personaId: null,
      llmConfigId: null,
      visionConfigId: null,
      ttsConfigId: null,
      configOverrides: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('parses a valid persona-history config row', () => {
    const result = ExportUserPersonaHistoryConfigRowSchema.safeParse({
      id: 'uphc-1',
      userId: 'user-1',
      personalityId: 'char-1',
      personaId: 'persona-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      lastContextReset: null,
      previousContextReset: null,
    });
    expect(result.success).toBe(true);
  });

  it('accepts null for user-defaults (unset)', () => {
    const result = ExportUserDefaultsSchema.safeParse(null);
    expect(result.success).toBe(true);
  });

  it('accepts an arbitrary object for user-defaults (set)', () => {
    const result = ExportUserDefaultsSchema.safeParse({ someKey: 'someValue' });
    expect(result.success).toBe(true);
  });
});
