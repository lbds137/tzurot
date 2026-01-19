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
      const response = mockListLlmConfigsResponse([{ name: 'Config 1' }, { name: 'Config 2' }]);

      expect(response.configs[0].id).toBe('config-0');
      expect(response.configs[1].id).toBe('config-1');
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
