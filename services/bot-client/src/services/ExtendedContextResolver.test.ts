/**
 * Tests for ExtendedContextResolver
 *
 * Tests all 9 combinations of the tri-state cascade:
 * - Personality: null (AUTO), true (ON), false (OFF)
 * - Channel: null (AUTO), true (ON), false (OFF)
 *
 * Resolution cascade (first non-null wins):
 * 1. Personality OFF (false) → disabled
 * 2. Personality ON (true) → enabled
 * 3. Personality AUTO (null) → check channel
 * 4. Channel OFF (false) → disabled
 * 5. Channel ON (true) → enabled
 * 6. Channel AUTO (null) → use global default
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

  describe('resolve - personality OFF (false) takes precedence', () => {
    it('should be disabled when personality=OFF, channel=ON, global=true', async () => {
      const personality = createMockPersonality(false);
      mockGatewayClient.getChannelSettings.mockResolvedValue(createMockChannelSettings(true));
      mockGatewayClient.getExtendedContextDefault.mockResolvedValue(true);

      const result = await resolver.resolve('channel-123', personality);

      expect(result.enabled).toBe(false);
      expect(result.source).toBe('personality');
      // Should not call gateway client at all
      expect(mockGatewayClient.getChannelSettings).not.toHaveBeenCalled();
      expect(mockGatewayClient.getExtendedContextDefault).not.toHaveBeenCalled();
    });

    it('should be disabled when personality=OFF, channel=OFF, global=true', async () => {
      const personality = createMockPersonality(false);
      mockGatewayClient.getChannelSettings.mockResolvedValue(createMockChannelSettings(false));
      mockGatewayClient.getExtendedContextDefault.mockResolvedValue(true);

      const result = await resolver.resolve('channel-123', personality);

      expect(result.enabled).toBe(false);
      expect(result.source).toBe('personality');
    });

    it('should be disabled when personality=OFF, channel=AUTO, global=true', async () => {
      const personality = createMockPersonality(false);
      mockGatewayClient.getChannelSettings.mockResolvedValue(createMockChannelSettings(null));
      mockGatewayClient.getExtendedContextDefault.mockResolvedValue(true);

      const result = await resolver.resolve('channel-123', personality);

      expect(result.enabled).toBe(false);
      expect(result.source).toBe('personality');
    });
  });

  describe('resolve - personality ON (true) takes precedence', () => {
    it('should be enabled when personality=ON, channel=ON, global=false', async () => {
      const personality = createMockPersonality(true);
      mockGatewayClient.getChannelSettings.mockResolvedValue(createMockChannelSettings(true));
      mockGatewayClient.getExtendedContextDefault.mockResolvedValue(false);

      const result = await resolver.resolve('channel-123', personality);

      expect(result.enabled).toBe(true);
      expect(result.source).toBe('personality');
      // Should not call gateway client at all
      expect(mockGatewayClient.getChannelSettings).not.toHaveBeenCalled();
      expect(mockGatewayClient.getExtendedContextDefault).not.toHaveBeenCalled();
    });

    it('should be enabled when personality=ON, channel=OFF, global=false', async () => {
      const personality = createMockPersonality(true);
      mockGatewayClient.getChannelSettings.mockResolvedValue(createMockChannelSettings(false));
      mockGatewayClient.getExtendedContextDefault.mockResolvedValue(false);

      const result = await resolver.resolve('channel-123', personality);

      expect(result.enabled).toBe(true);
      expect(result.source).toBe('personality');
    });

    it('should be enabled when personality=ON, channel=AUTO, global=false', async () => {
      const personality = createMockPersonality(true);
      mockGatewayClient.getChannelSettings.mockResolvedValue(createMockChannelSettings(null));
      mockGatewayClient.getExtendedContextDefault.mockResolvedValue(false);

      const result = await resolver.resolve('channel-123', personality);

      expect(result.enabled).toBe(true);
      expect(result.source).toBe('personality');
    });
  });

  describe('resolve - personality AUTO (null) defers to channel', () => {
    it('should be enabled when personality=AUTO, channel=ON, global=false', async () => {
      const personality = createMockPersonality(null);
      mockGatewayClient.getChannelSettings.mockResolvedValue(createMockChannelSettings(true));

      const result = await resolver.resolve('channel-123', personality);

      expect(result.enabled).toBe(true);
      expect(result.source).toBe('channel');
      expect(mockGatewayClient.getExtendedContextDefault).not.toHaveBeenCalled();
    });

    it('should be disabled when personality=AUTO, channel=OFF, global=true', async () => {
      const personality = createMockPersonality(null);
      mockGatewayClient.getChannelSettings.mockResolvedValue(createMockChannelSettings(false));
      mockGatewayClient.getExtendedContextDefault.mockResolvedValue(true);

      const result = await resolver.resolve('channel-123', personality);

      expect(result.enabled).toBe(false);
      expect(result.source).toBe('channel');
      expect(mockGatewayClient.getExtendedContextDefault).not.toHaveBeenCalled();
    });

    it('should use global default when personality=AUTO, channel=AUTO, global=true', async () => {
      const personality = createMockPersonality(null);
      mockGatewayClient.getChannelSettings.mockResolvedValue(createMockChannelSettings(null));
      mockGatewayClient.getExtendedContextDefault.mockResolvedValue(true);

      const result = await resolver.resolve('channel-123', personality);

      expect(result.enabled).toBe(true);
      expect(result.source).toBe('global');
      expect(mockGatewayClient.getExtendedContextDefault).toHaveBeenCalled();
    });

    it('should use global default when personality=AUTO, channel=AUTO, global=false', async () => {
      const personality = createMockPersonality(null);
      mockGatewayClient.getChannelSettings.mockResolvedValue(createMockChannelSettings(null));
      mockGatewayClient.getExtendedContextDefault.mockResolvedValue(false);

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
      mockGatewayClient.getExtendedContextDefault.mockResolvedValue(false);

      const result = await resolver.resolve('channel-123', personality);

      expect(result.enabled).toBe(false);
      expect(result.source).toBe('global');
    });

    it('should use global default when channel settings request returns null', async () => {
      const personality = createMockPersonality(null);
      mockGatewayClient.getChannelSettings.mockResolvedValue(null);
      mockGatewayClient.getExtendedContextDefault.mockResolvedValue(true);

      const result = await resolver.resolve('channel-123', personality);

      expect(result.enabled).toBe(true);
      expect(result.source).toBe('global');
    });

    it('should handle undefined extendedContext as AUTO', async () => {
      // extendedContext undefined should be treated as AUTO
      const personality = createMockPersonality(undefined);
      mockGatewayClient.getChannelSettings.mockResolvedValue(createMockChannelSettings(true));

      const result = await resolver.resolve('channel-123', personality);

      // Should fall through to channel since personality extendedContext is undefined (AUTO)
      expect(result.enabled).toBe(true);
      expect(result.source).toBe('channel');
    });
  });
});
