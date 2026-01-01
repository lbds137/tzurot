/**
 * Tests for ExtendedContextResolver
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExtendedContextResolver } from './ExtendedContextResolver.js';
import { GatewayClient } from '../utils/GatewayClient.js';
import type { LoadedPersonality } from '../types.js';
import type { GetChannelSettingsResponse } from '@tzurot/common-types';

// Mock the logger
vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

// Create mock personality
function createMockPersonality(overrides: Partial<LoadedPersonality> = {}): LoadedPersonality {
  return {
    id: 'personality-123',
    name: 'TestPersonality',
    displayName: 'Test Personality',
    slug: 'test',
    systemPrompt: 'You are a helpful assistant',
    model: 'anthropic/claude-sonnet-4.5',
    temperature: 0.7,
    maxTokens: 2000,
    contextWindowTokens: 8192,
    characterInfo: 'A helpful test personality',
    personalityTraits: 'Helpful, friendly',
    supportsExtendedContext: true, // Default to true
    ...overrides,
  };
}

// Create mock channel settings response
function createMockChannelSettings(extendedContext: boolean | null): GetChannelSettingsResponse {
  return {
    hasSettings: true,
    settings: {
      id: 'settings-123',
      channelId: 'channel-123',
      guildId: 'guild-123',
      personalitySlug: 'test',
      personalityName: 'Test Personality',
      autoRespond: true,
      extendedContext,
      activatedBy: 'user-123',
      createdAt: new Date().toISOString(),
    },
  };
}

describe('ExtendedContextResolver', () => {
  let resolver: ExtendedContextResolver;
  let mockGatewayClient: {
    getChannelSettings: ReturnType<typeof vi.fn>;
    getExtendedContextDefault: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGatewayClient = {
      getChannelSettings: vi.fn(),
      getExtendedContextDefault: vi.fn(),
    };
    resolver = new ExtendedContextResolver(mockGatewayClient as unknown as GatewayClient);
  });

  describe('resolve', () => {
    it('should return disabled when personality does not support extended context', async () => {
      const personality = createMockPersonality({ supportsExtendedContext: false });

      const result = await resolver.resolve('channel-123', personality);

      expect(result.enabled).toBe(false);
      expect(result.source).toBe('personality');
      // Should not call gateway client at all
      expect(mockGatewayClient.getChannelSettings).not.toHaveBeenCalled();
      expect(mockGatewayClient.getExtendedContextDefault).not.toHaveBeenCalled();
    });

    it('should use channel setting when explicitly set to true', async () => {
      const personality = createMockPersonality();
      mockGatewayClient.getChannelSettings.mockResolvedValue(createMockChannelSettings(true));

      const result = await resolver.resolve('channel-123', personality);

      expect(result.enabled).toBe(true);
      expect(result.source).toBe('channel');
      expect(mockGatewayClient.getExtendedContextDefault).not.toHaveBeenCalled();
    });

    it('should use channel setting when explicitly set to false', async () => {
      const personality = createMockPersonality();
      mockGatewayClient.getChannelSettings.mockResolvedValue(createMockChannelSettings(false));

      const result = await resolver.resolve('channel-123', personality);

      expect(result.enabled).toBe(false);
      expect(result.source).toBe('channel');
      expect(mockGatewayClient.getExtendedContextDefault).not.toHaveBeenCalled();
    });

    it('should use global default when channel setting is null', async () => {
      const personality = createMockPersonality();
      mockGatewayClient.getChannelSettings.mockResolvedValue(createMockChannelSettings(null));
      mockGatewayClient.getExtendedContextDefault.mockResolvedValue(true);

      const result = await resolver.resolve('channel-123', personality);

      expect(result.enabled).toBe(true);
      expect(result.source).toBe('global');
      expect(mockGatewayClient.getExtendedContextDefault).toHaveBeenCalled();
    });

    it('should use global default when no channel settings exist', async () => {
      const personality = createMockPersonality();
      mockGatewayClient.getChannelSettings.mockResolvedValue({
        hasSettings: false,
      });
      mockGatewayClient.getExtendedContextDefault.mockResolvedValue(false);

      const result = await resolver.resolve('channel-123', personality);

      expect(result.enabled).toBe(false);
      expect(result.source).toBe('global');
    });

    it('should use global default when channel settings request returns null', async () => {
      const personality = createMockPersonality();
      mockGatewayClient.getChannelSettings.mockResolvedValue(null);
      mockGatewayClient.getExtendedContextDefault.mockResolvedValue(true);

      const result = await resolver.resolve('channel-123', personality);

      expect(result.enabled).toBe(true);
      expect(result.source).toBe('global');
    });

    it('should default to false when global default fails', async () => {
      const personality = createMockPersonality();
      mockGatewayClient.getChannelSettings.mockResolvedValue(null);
      mockGatewayClient.getExtendedContextDefault.mockResolvedValue(false);

      const result = await resolver.resolve('channel-123', personality);

      expect(result.enabled).toBe(false);
      expect(result.source).toBe('global');
    });

    it('should check personality support before fetching settings', async () => {
      const personality = createMockPersonality({ supportsExtendedContext: false });
      mockGatewayClient.getChannelSettings.mockResolvedValue(createMockChannelSettings(true));
      mockGatewayClient.getExtendedContextDefault.mockResolvedValue(true);

      const result = await resolver.resolve('channel-123', personality);

      // Personality opt-out should take precedence
      expect(result.enabled).toBe(false);
      expect(result.source).toBe('personality');
    });

    it('should handle undefined supportsExtendedContext as supported', async () => {
      // supportsExtendedContext undefined should be treated as supported
      const personality = createMockPersonality();
      // Cast to remove the property
      delete (personality as Partial<LoadedPersonality>).supportsExtendedContext;

      mockGatewayClient.getChannelSettings.mockResolvedValue(createMockChannelSettings(true));

      const result = await resolver.resolve('channel-123', personality);

      expect(result.enabled).toBe(true);
      expect(result.source).toBe('channel');
    });
  });
});
