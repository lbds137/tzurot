/**
 * Tests for ExtendedContextResolver
 *
 * Tests all 9 combinations of the tri-state cascade:
 * - Personality: null (AUTO), true (ON), false (OFF)
 * - Channel: null (AUTO), true (ON), false (OFF)
 *
 * Resolution cascade (most restrictive wins):
 * 1. If ANY level is OFF → disabled (OFF always wins)
 * 2. If all non-null levels are ON → enabled
 * 3. If all levels are AUTO → use global default
 *
 * @see docs/standards/TRI_STATE_PATTERN.md
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

// Create mock personality with tri-state extendedContext
function createMockPersonality(
  extendedContext: boolean | null | undefined = null
): LoadedPersonality {
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
    extendedContext,
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
      extendedContextMaxMessages: null,
      extendedContextMaxAge: null,
      extendedContextMaxImages: null,
      activatedBy: 'user-123',
      createdAt: new Date().toISOString(),
    },
  };
}

// Create mock admin settings response
function createMockAdminSettings(extendedContextDefaultValue: boolean = false) {
  return {
    extendedContextDefault: extendedContextDefaultValue,
    extendedContextMaxMessages: 20,
    extendedContextMaxAge: null,
    extendedContextMaxImages: 0,
  };
}

describe('ExtendedContextResolver', () => {
  let resolver: ExtendedContextResolver;
  let mockGatewayClient: {
    getChannelSettings: ReturnType<typeof vi.fn>;
    getExtendedContextDefault: ReturnType<typeof vi.fn>;
    getAdminSettings: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGatewayClient = {
      getChannelSettings: vi.fn(),
      getExtendedContextDefault: vi.fn(),
      getAdminSettings: vi.fn().mockResolvedValue(createMockAdminSettings(false)),
    };
    resolver = new ExtendedContextResolver(mockGatewayClient as unknown as GatewayClient);
  });

  describe('resolve - personality OFF (false) takes precedence', () => {
    it('should be disabled when personality=OFF, channel=ON, global=true', async () => {
      const personality = createMockPersonality(false);
      mockGatewayClient.getChannelSettings.mockResolvedValue(createMockChannelSettings(true));
      mockGatewayClient.getAdminSettings.mockResolvedValue(createMockAdminSettings(true));

      const result = await resolver.resolve('channel-123', personality);

      expect(result.enabled).toBe(false);
      expect(result.source).toBe('personality');
    });

    it('should be disabled when personality=OFF, channel=OFF, global=true', async () => {
      const personality = createMockPersonality(false);
      mockGatewayClient.getChannelSettings.mockResolvedValue(createMockChannelSettings(false));
      mockGatewayClient.getAdminSettings.mockResolvedValue(createMockAdminSettings(true));

      const result = await resolver.resolve('channel-123', personality);

      expect(result.enabled).toBe(false);
      // Both are OFF, source reports the first OFF found in hierarchy (channel is evaluated first)
      expect(result.source).toBe('channel');
    });

    it('should be disabled when personality=OFF, channel=AUTO, global=true', async () => {
      const personality = createMockPersonality(false);
      mockGatewayClient.getChannelSettings.mockResolvedValue(createMockChannelSettings(null));
      mockGatewayClient.getAdminSettings.mockResolvedValue(createMockAdminSettings(true));

      const result = await resolver.resolve('channel-123', personality);

      expect(result.enabled).toBe(false);
      expect(result.source).toBe('personality');
    });
  });

  describe('resolve - personality ON (true) behavior', () => {
    it('should be enabled when personality=ON, channel=ON (both agree)', async () => {
      const personality = createMockPersonality(true);
      mockGatewayClient.getChannelSettings.mockResolvedValue(createMockChannelSettings(true));
      mockGatewayClient.getAdminSettings.mockResolvedValue(createMockAdminSettings(false));

      const result = await resolver.resolve('channel-123', personality);

      expect(result.enabled).toBe(true);
      // Both are ON, source reports first ON found (channel is first non-null)
      expect(result.source).toBe('channel');
    });

    it('should be disabled when personality=ON, channel=OFF (OFF wins)', async () => {
      const personality = createMockPersonality(true);
      mockGatewayClient.getChannelSettings.mockResolvedValue(createMockChannelSettings(false));
      mockGatewayClient.getAdminSettings.mockResolvedValue(createMockAdminSettings(false));

      const result = await resolver.resolve('channel-123', personality);

      // OFF is most restrictive, so it wins
      expect(result.enabled).toBe(false);
      expect(result.source).toBe('channel');
    });

    it('should be enabled when personality=ON, channel=AUTO (ON wins over AUTO)', async () => {
      const personality = createMockPersonality(true);
      mockGatewayClient.getChannelSettings.mockResolvedValue(createMockChannelSettings(null));
      mockGatewayClient.getAdminSettings.mockResolvedValue(createMockAdminSettings(false));

      const result = await resolver.resolve('channel-123', personality);

      expect(result.enabled).toBe(true);
      expect(result.source).toBe('personality');
    });
  });

  describe('resolve - personality AUTO (null) defers to channel', () => {
    it('should be enabled when personality=AUTO, channel=ON, global=false', async () => {
      const personality = createMockPersonality(null);
      mockGatewayClient.getChannelSettings.mockResolvedValue(createMockChannelSettings(true));
      mockGatewayClient.getAdminSettings.mockResolvedValue(createMockAdminSettings(false));

      const result = await resolver.resolve('channel-123', personality);

      expect(result.enabled).toBe(true);
      expect(result.source).toBe('channel');
    });

    it('should be disabled when personality=AUTO, channel=OFF, global=true', async () => {
      const personality = createMockPersonality(null);
      mockGatewayClient.getChannelSettings.mockResolvedValue(createMockChannelSettings(false));
      mockGatewayClient.getAdminSettings.mockResolvedValue(createMockAdminSettings(true));

      const result = await resolver.resolve('channel-123', personality);

      expect(result.enabled).toBe(false);
      expect(result.source).toBe('channel');
    });

    it('should use global default when personality=AUTO, channel=AUTO, global=true', async () => {
      const personality = createMockPersonality(null);
      mockGatewayClient.getChannelSettings.mockResolvedValue(createMockChannelSettings(null));
      mockGatewayClient.getAdminSettings.mockResolvedValue(createMockAdminSettings(true));

      const result = await resolver.resolve('channel-123', personality);

      expect(result.enabled).toBe(true);
      expect(result.source).toBe('global');
    });

    it('should use global default when personality=AUTO, channel=AUTO, global=false', async () => {
      const personality = createMockPersonality(null);
      mockGatewayClient.getChannelSettings.mockResolvedValue(createMockChannelSettings(null));
      mockGatewayClient.getAdminSettings.mockResolvedValue(createMockAdminSettings(false));

      const result = await resolver.resolve('channel-123', personality);

      expect(result.enabled).toBe(false);
      expect(result.source).toBe('global');
    });
  });

  describe('resolve - edge cases', () => {
    it('should use global default when no channel settings exist', async () => {
      const personality = createMockPersonality(null);
      mockGatewayClient.getChannelSettings.mockResolvedValue({
        hasSettings: false,
      });
      mockGatewayClient.getAdminSettings.mockResolvedValue(createMockAdminSettings(false));

      const result = await resolver.resolve('channel-123', personality);

      expect(result.enabled).toBe(false);
      expect(result.source).toBe('global');
    });

    it('should use global default when channel settings request returns null', async () => {
      const personality = createMockPersonality(null);
      mockGatewayClient.getChannelSettings.mockResolvedValue(null);
      mockGatewayClient.getAdminSettings.mockResolvedValue(createMockAdminSettings(true));

      const result = await resolver.resolve('channel-123', personality);

      expect(result.enabled).toBe(true);
      expect(result.source).toBe('global');
    });

    it('should handle undefined extendedContext as AUTO', async () => {
      // extendedContext undefined should be treated as AUTO
      const personality = createMockPersonality(undefined);
      mockGatewayClient.getChannelSettings.mockResolvedValue(createMockChannelSettings(true));
      mockGatewayClient.getAdminSettings.mockResolvedValue(createMockAdminSettings(false));

      const result = await resolver.resolve('channel-123', personality);

      // Should fall through to channel since personality extendedContext is undefined (AUTO)
      expect(result.enabled).toBe(true);
      expect(result.source).toBe('channel');
    });
  });
});
