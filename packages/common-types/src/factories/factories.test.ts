/**
 * Tests for Validated Mock Factories
 *
 * These tests verify that the mock factories:
 * 1. Produce valid data that passes Zod schema validation
 * 2. Allow proper overrides of default values
 * 3. Fail fast on invalid overrides (via Zod validation)
 */

import { describe, it, expect } from 'vitest';
import {
  mockListPersonalitiesResponse,
  mockCreatePersonalityResponse,
  mockGetPersonalityResponse,
} from './personality.js';
import { mockListPersonasResponse } from './persona.js';
import {
  mockLlmConfigSummary,
  mockListLlmConfigsResponse,
  mockCreateLlmConfigResponse,
  mockDeleteLlmConfigResponse,
} from './llm-config.js';

describe('personality factories', () => {
  describe('mockListPersonalitiesResponse', () => {
    it('should create valid response with default personality', () => {
      const response = mockListPersonalitiesResponse();

      expect(response.personalities).toHaveLength(1);
      expect(response.personalities[0]).toMatchObject({
        name: 'TestCharacter',
        slug: 'test-character',
        isOwned: true,
        permissions: { canEdit: true, canDelete: true },
      });
    });

    it('should create valid response with custom personalities', () => {
      const response = mockListPersonalitiesResponse([
        { name: 'Character1', isOwned: true },
        { name: 'Character2', isOwned: false, isPublic: true },
      ]);

      expect(response.personalities).toHaveLength(2);
      expect(response.personalities[0].name).toBe('Character1');
      expect(response.personalities[1].name).toBe('Character2');
    });

    it('should include permissions with default values', () => {
      const response = mockListPersonalitiesResponse([{ name: 'Test' }]);

      expect(response.personalities[0].permissions).toEqual({
        canEdit: true,
        canDelete: true,
      });
    });

    it('should allow overriding permissions', () => {
      const response = mockListPersonalitiesResponse([
        { name: 'Test', permissions: { canEdit: false, canDelete: false } },
      ]);

      expect(response.personalities[0].permissions).toEqual({
        canEdit: false,
        canDelete: false,
      });
    });

    // Regression: prior to the duplicate-ID factory fix, multi-personality
    // tests without explicit `id` overrides produced lists where every item
    // shared DEFAULT_PERSONALITY_ID. This is invalid data — Discord select
    // menus reject duplicate option values, and downstream factories like
    // buildBrowseSelectMenu now throw on duplicates. Index 0 keeps
    // DEFAULT_PERSONALITY_ID for backwards compatibility; indexes 1+ get
    // a deterministic suffix.
    it('should auto-generate unique ids and slugs for multi-personality lists', () => {
      const response = mockListPersonalitiesResponse([
        { name: 'First' },
        { name: 'Second' },
        { name: 'Third' },
      ]);

      expect(response.personalities).toHaveLength(3);

      // All ids must be distinct
      const ids = response.personalities.map(p => p.id);
      expect(new Set(ids).size).toBe(3);

      // All slugs must be distinct (also rejected as duplicates by Discord)
      const slugs = response.personalities.map(p => p.slug);
      expect(new Set(slugs).size).toBe(3);

      // Index 0 keeps the default for backwards compatibility
      expect(response.personalities[0].id).toBe('33333333-3333-5333-8333-333333333333');
      expect(response.personalities[0].slug).toBe('test-character');
    });

    it('should respect explicit id overrides even when generating uniques for siblings', () => {
      const explicitId = '11111111-1111-5111-8111-111111111111';
      const response = mockListPersonalitiesResponse([
        { name: 'First' },
        { id: explicitId, name: 'Second' },
        { name: 'Third' },
      ]);

      expect(response.personalities[1].id).toBe(explicitId);
      // Distinct overall — index-0 default + explicit + index-2 generated
      const ids = response.personalities.map(p => p.id);
      expect(new Set(ids).size).toBe(3);
    });
  });

  describe('mockCreatePersonalityResponse', () => {
    it('should create valid response with defaults', () => {
      const response = mockCreatePersonalityResponse();

      expect(response.success).toBe(true);
      expect(response.personality).toBeDefined();
      expect(response.personality.name).toBe('TestCharacter');
    });

    it('should allow overriding personality fields', () => {
      const response = mockCreatePersonalityResponse({ name: 'CustomName' });

      expect(response.personality.name).toBe('CustomName');
    });
  });

  describe('mockGetPersonalityResponse', () => {
    it('should create valid response with defaults', () => {
      const response = mockGetPersonalityResponse();

      expect(response.personality).toBeDefined();
      expect(response.personality.name).toBe('TestCharacter');
    });

    it('should allow overriding personality fields', () => {
      const response = mockGetPersonalityResponse({
        name: 'CustomName',
        isPublic: true,
      });

      expect(response.personality.name).toBe('CustomName');
      expect(response.personality.isPublic).toBe(true);
    });
  });
});

describe('persona factories', () => {
  describe('mockListPersonasResponse', () => {
    it('should create a valid response with the default persona when called with no args', () => {
      const response = mockListPersonasResponse();

      expect(response.personas).toHaveLength(1);
      expect(response.personas[0]).toMatchObject({
        name: 'TestPersona',
        preferredName: 'Tester',
      });
    });

    it('should create a valid response with custom personas', () => {
      const response = mockListPersonasResponse([
        { name: 'PersonaA', isDefault: true },
        { name: 'PersonaB', isDefault: false },
      ]);

      expect(response.personas).toHaveLength(2);
      expect(response.personas[0].name).toBe('PersonaA');
      expect(response.personas[1].name).toBe('PersonaB');
    });

    // Regression: prior to the duplicate-ID factory fix, multi-persona tests
    // without explicit `id` overrides produced lists where every item shared
    // DEFAULT_PERSONA_ID. buildBrowseSelectMenu now throws on duplicate
    // option values, so this test locks the auto-uniqueness behavior in.
    it('should auto-generate unique ids for multi-persona lists', () => {
      const response = mockListPersonasResponse([
        { name: 'First' },
        { name: 'Second' },
        { name: 'Third' },
      ]);

      expect(response.personas).toHaveLength(3);

      // All ids must be distinct
      const ids = response.personas.map(p => p.id);
      expect(new Set(ids).size).toBe(3);

      // Index 0 keeps DEFAULT_PERSONA_ID for backwards compatibility
      expect(response.personas[0].id).toBe('22222222-2222-5222-8222-222222222222');
    });

    it('should respect explicit id overrides even when generating uniques for siblings', () => {
      const explicitId = '99999999-9999-5999-8999-999999999999';
      const response = mockListPersonasResponse([
        { name: 'First' },
        { id: explicitId, name: 'Second' },
        { name: 'Third' },
      ]);

      expect(response.personas[1].id).toBe(explicitId);
      // Distinct overall — index-0 default + explicit + index-2 generated
      const ids = response.personas.map(p => p.id);
      expect(new Set(ids).size).toBe(3);
    });
  });
});

describe('llm-config factories', () => {
  describe('mockLlmConfigSummary', () => {
    it('should create valid summary with defaults', () => {
      const summary = mockLlmConfigSummary();

      expect(summary).toMatchObject({
        name: 'Default Config',
        provider: 'openrouter',
        model: 'openai/gpt-4o-mini',
        isGlobal: true,
        isDefault: true,
        isOwned: false,
        permissions: { canEdit: false, canDelete: false },
      });
    });

    it('should allow overriding fields', () => {
      const summary = mockLlmConfigSummary({
        name: 'Custom Config',
        isGlobal: false,
        isOwned: true,
      });

      expect(summary.name).toBe('Custom Config');
      expect(summary.isGlobal).toBe(false);
      expect(summary.isOwned).toBe(true);
    });

    it('should merge permissions correctly', () => {
      const summary = mockLlmConfigSummary({
        permissions: { canEdit: true, canDelete: false },
      });

      expect(summary.permissions).toEqual({
        canEdit: true,
        canDelete: false,
      });
    });
  });

  describe('mockListLlmConfigsResponse', () => {
    it('should create valid response with empty configs', () => {
      const response = mockListLlmConfigsResponse([]);

      expect(response.configs).toHaveLength(0);
    });

    it('should create valid response with multiple configs', () => {
      const response = mockListLlmConfigsResponse([
        { name: 'Config 1', isGlobal: true },
        { name: 'Config 2', isGlobal: false, isOwned: true },
      ]);

      expect(response.configs).toHaveLength(2);
      expect(response.configs[0].name).toBe('Config 1');
      expect(response.configs[1].name).toBe('Config 2');
    });

    it('should assign unique IDs to configs', () => {
      // IDs are derived from the index as stable RFC-4122-valid UUIDs
      // (variant=8, version=4, last 12 hex digits = index as hex). The
      // response-schema tightening added in PR #827 follow-up requires
      // real UUIDs here — previously `config-${i}`.
      const response = mockListLlmConfigsResponse([{ name: 'Config 1' }, { name: 'Config 2' }]);

      expect(response.configs[0].id).toBe('00000000-0000-4000-8000-000000000000');
      expect(response.configs[1].id).toBe('00000000-0000-4000-8000-000000000001');
      expect(response.configs[0].id).not.toBe(response.configs[1].id);
    });
  });

  describe('mockCreateLlmConfigResponse', () => {
    it('should create valid response with user-owned defaults', () => {
      const response = mockCreateLlmConfigResponse();

      expect(response.config).toMatchObject({
        isGlobal: false,
        isDefault: false,
        isOwned: true,
        permissions: { canEdit: true, canDelete: true },
      });
    });

    it('should allow overriding config fields', () => {
      const response = mockCreateLlmConfigResponse({
        name: 'My New Config',
        model: 'anthropic/claude-sonnet-4',
      });

      expect(response.config.name).toBe('My New Config');
      expect(response.config.model).toBe('anthropic/claude-sonnet-4');
    });
  });

  describe('mockDeleteLlmConfigResponse', () => {
    it('should create valid delete response', () => {
      const response = mockDeleteLlmConfigResponse();

      expect(response).toEqual({ deleted: true });
    });
  });
});

describe('factory validation', () => {
  it('should throw ZodError for invalid personality UUID', () => {
    expect(() => mockListPersonalitiesResponse([{ id: 'not-a-uuid' }])).toThrow();
  });

  it('should accept valid UUID for personality', () => {
    const response = mockListPersonalitiesResponse([
      { id: '11111111-1111-5111-8111-111111111111' },
    ]);

    expect(response.personalities[0].id).toBe('11111111-1111-5111-8111-111111111111');
  });
});
