/**
 * Tests for Memory Incognito Mode Handlers
 *
 * Tests updated to match DeferredCommandContext pattern where:
 * - context.user.id for user ID
 * - context.interaction.options for command options
 * - context.editReply for responses
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  handleIncognitoEnable,
  handleIncognitoDisable,
  handleIncognitoStatus,
  handleIncognitoForget,
} from './incognito.js';

// Mock common-types
vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

// Mock userGatewayClient
const mockCallGatewayApi = vi.fn();
vi.mock('../../utils/userGatewayClient.js', () => ({
  callGatewayApi: (...args: unknown[]) => mockCallGatewayApi(...args),
}));

// Mock commandHelpers - embeds return empty objects for test simplicity
const mockCreateSuccessEmbed = vi.fn(() => ({ type: 'success' }));
const mockCreateInfoEmbed = vi.fn(() => ({ type: 'info' }));
const mockCreateWarningEmbed = vi.fn(() => ({ type: 'warning' }));
vi.mock('../../utils/commandHelpers.js', () => ({
  createSuccessEmbed: (...args: unknown[]) =>
    mockCreateSuccessEmbed(...(args as Parameters<typeof mockCreateSuccessEmbed>)),
  createInfoEmbed: (...args: unknown[]) =>
    mockCreateInfoEmbed(...(args as Parameters<typeof mockCreateInfoEmbed>)),
  createWarningEmbed: (...args: unknown[]) =>
    mockCreateWarningEmbed(...(args as Parameters<typeof mockCreateWarningEmbed>)),
}));

// Mock autocomplete
const mockResolvePersonalityId = vi.fn();
const mockGetPersonalityName = vi.fn();
vi.mock('./autocomplete.js', () => ({
  resolvePersonalityId: (...args: unknown[]) => mockResolvePersonalityId(...args),
  getPersonalityName: (...args: unknown[]) => mockGetPersonalityName(...args),
}));

describe('Memory Incognito Handlers', () => {
  const mockEditReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Helper to create mock DeferredCommandContext with different options
  function createMockContext(options: {
    personality?: string;
    duration?: string;
    timeframe?: string;
  }) {
    return {
      user: { id: '123456789' },
      interaction: {
        options: {
          getString: (name: string, _required?: boolean) => {
            if (name === 'personality') return options.personality ?? 'lilith';
            if (name === 'duration') return options.duration ?? '1h';
            if (name === 'timeframe') return options.timeframe ?? '15m';
            return null;
          },
        },
      },
      editReply: mockEditReply,
    } as unknown as Parameters<typeof handleIncognitoEnable>[0];
  }

  describe('handleIncognitoEnable', () => {
    it('should enable incognito mode for specific personality', async () => {
      mockResolvePersonalityId.mockResolvedValue('personality-uuid-123');
      mockGetPersonalityName.mockResolvedValue('Lilith');
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: {
          session: {
            userId: '123456789',
            personalityId: 'personality-uuid-123',
            enabledAt: '2026-01-15T12:00:00Z',
            expiresAt: '2026-01-15T13:00:00Z',
            duration: '1h',
          },
          timeRemaining: '1h remaining',
          wasAlreadyActive: false,
          message: 'Incognito mode enabled for Lilith (1 hour)',
        },
      });

      const context = createMockContext({ personality: 'lilith', duration: '1h' });
      await handleIncognitoEnable(context);

      expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/memory/incognito', {
        userId: '123456789',
        method: 'POST',
        body: { personalityId: 'personality-uuid-123', duration: '1h' },
      });
      expect(mockCreateSuccessEmbed).toHaveBeenCalledWith(
        '👻 Incognito Mode Enabled',
        expect.stringContaining('enabled')
      );
      expect(mockEditReply).toHaveBeenCalledWith({ embeds: [expect.anything()] });
    });

    it('should enable incognito mode for all personalities', async () => {
      // 'all' is handled specially - no resolvePersonalityId call
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: {
          session: {
            userId: '123456789',
            personalityId: 'all',
            enabledAt: '2026-01-15T12:00:00Z',
            expiresAt: null,
            duration: 'forever',
          },
          timeRemaining: 'Until manually disabled',
          wasAlreadyActive: false,
          message: 'Incognito mode enabled for all personalities',
        },
      });

      const context = createMockContext({ personality: 'all', duration: 'forever' });
      await handleIncognitoEnable(context);

      expect(mockResolvePersonalityId).not.toHaveBeenCalled();
      expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/memory/incognito', {
        userId: '123456789',
        method: 'POST',
        body: { personalityId: 'all', duration: 'forever' },
      });
      expect(mockCreateSuccessEmbed).toHaveBeenCalled();
    });

    it('should show info embed when already active', async () => {
      mockResolvePersonalityId.mockResolvedValue('personality-uuid-123');
      mockGetPersonalityName.mockResolvedValue('Lilith');
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: {
          session: {
            userId: '123456789',
            personalityId: 'personality-uuid-123',
            enabledAt: '2026-01-15T11:00:00Z',
            expiresAt: '2026-01-15T12:00:00Z',
            duration: '1h',
          },
          timeRemaining: '30m remaining',
          wasAlreadyActive: true,
          message: 'Incognito mode is already active for Lilith',
        },
      });

      const context = createMockContext({ personality: 'lilith' });
      await handleIncognitoEnable(context);

      expect(mockCreateInfoEmbed).toHaveBeenCalledWith(
        '👻 Incognito Already Active',
        expect.stringContaining('already active')
      );
    });

    it('should handle personality not found', async () => {
      mockResolvePersonalityId.mockResolvedValue(null);

      const context = createMockContext({ personality: 'unknown' });
      await handleIncognitoEnable(context);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('unknown'),
      });
      expect(mockCallGatewayApi).not.toHaveBeenCalled();
    });

    it('should handle API error', async () => {
      mockResolvePersonalityId.mockResolvedValue('personality-uuid-123');
      mockGetPersonalityName.mockResolvedValue('Lilith');
      mockCallGatewayApi.mockResolvedValue({
        ok: false,
        status: 500,
        error: 'Server error',
      });

      const context = createMockContext({ personality: 'lilith' });
      await handleIncognitoEnable(context);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Failed to enable incognito mode'),
      });
    });

    it('should handle exceptions', async () => {
      const error = new Error('Network error');
      mockResolvePersonalityId.mockRejectedValue(error);

      const context = createMockContext({ personality: 'lilith' });
      await handleIncognitoEnable(context);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('unexpected error'),
      });
    });
  });

  describe('handleIncognitoDisable', () => {
    it('should disable incognito mode successfully', async () => {
      mockResolvePersonalityId.mockResolvedValue('personality-uuid-123');
      mockGetPersonalityName.mockResolvedValue('Lilith');
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: {
          disabled: true,
          message: 'Incognito mode disabled for Lilith',
        },
      });

      const context = createMockContext({ personality: 'lilith' });
      await handleIncognitoDisable(context);

      expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/memory/incognito', {
        userId: '123456789',
        method: 'DELETE',
        body: { personalityId: 'personality-uuid-123' },
      });
      expect(mockCreateSuccessEmbed).toHaveBeenCalledWith(
        '👻 Incognito Mode Disabled',
        expect.stringContaining('disabled')
      );
    });

    it('should disable incognito for all personalities', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: {
          disabled: true,
          message: 'Incognito mode disabled for all personalities',
        },
      });

      const context = createMockContext({ personality: 'all' });
      await handleIncognitoDisable(context);

      expect(mockResolvePersonalityId).not.toHaveBeenCalled();
      expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/memory/incognito', {
        userId: '123456789',
        method: 'DELETE',
        body: { personalityId: 'all' },
      });
    });

    it('should show info when incognito was not active', async () => {
      mockResolvePersonalityId.mockResolvedValue('personality-uuid-123');
      mockGetPersonalityName.mockResolvedValue('Lilith');
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: {
          disabled: false,
          message: 'Incognito mode was not active for Lilith',
        },
      });

      const context = createMockContext({ personality: 'lilith' });
      await handleIncognitoDisable(context);

      expect(mockCreateInfoEmbed).toHaveBeenCalledWith(
        '👻 Incognito Not Active',
        expect.stringContaining('was not active')
      );
    });

    it('should handle personality not found', async () => {
      mockResolvePersonalityId.mockResolvedValue(null);

      const context = createMockContext({ personality: 'unknown' });
      await handleIncognitoDisable(context);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('unknown'),
      });
    });

    it('should handle API error', async () => {
      mockResolvePersonalityId.mockResolvedValue('personality-uuid-123');
      mockCallGatewayApi.mockResolvedValue({
        ok: false,
        status: 500,
        error: 'Server error',
      });

      const context = createMockContext({ personality: 'lilith' });
      await handleIncognitoDisable(context);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Failed to disable incognito mode'),
      });
    });

    it('should handle exceptions', async () => {
      const error = new Error('Network error');
      mockResolvePersonalityId.mockRejectedValue(error);

      const context = createMockContext({ personality: 'lilith' });
      await handleIncognitoDisable(context);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('unexpected error'),
      });
    });
  });

  describe('handleIncognitoStatus', () => {
    it('should show inactive status when no sessions', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: {
          active: false,
          sessions: [],
        },
      });

      const context = createMockContext({});
      await handleIncognitoStatus(context);

      expect(mockCreateInfoEmbed).toHaveBeenCalledWith(
        '👻 Incognito Status',
        expect.stringContaining('not active')
      );
    });

    it('should show active status with single session', async () => {
      mockGetPersonalityName.mockResolvedValue('Lilith');
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: {
          active: true,
          sessions: [
            {
              userId: '123456789',
              personalityId: 'personality-uuid-123',
              enabledAt: '2026-01-15T11:00:00Z',
              expiresAt: '2026-01-15T13:00:00Z',
              duration: '1h',
              timeRemaining: '1h remaining',
            },
          ],
        },
      });

      const context = createMockContext({});
      await handleIncognitoStatus(context);

      expect(mockCreateWarningEmbed).toHaveBeenCalledWith(
        '👻 Incognito Active',
        expect.stringContaining('active')
      );
    });

    it('should show active status with multiple sessions', async () => {
      mockGetPersonalityName.mockResolvedValueOnce('Lilith').mockResolvedValueOnce('Sarcastic');
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: {
          active: true,
          sessions: [
            {
              userId: '123456789',
              personalityId: 'personality-uuid-1',
              enabledAt: '2026-01-15T11:00:00Z',
              expiresAt: '2026-01-15T13:00:00Z',
              duration: '1h',
              timeRemaining: '1h remaining',
            },
            {
              userId: '123456789',
              personalityId: 'personality-uuid-2',
              enabledAt: '2026-01-15T11:30:00Z',
              expiresAt: '2026-01-15T15:30:00Z',
              duration: '4h',
              timeRemaining: '3h 30m remaining',
            },
          ],
        },
      });

      const context = createMockContext({});
      await handleIncognitoStatus(context);

      expect(mockGetPersonalityName).toHaveBeenCalledTimes(2);
      expect(mockCreateWarningEmbed).toHaveBeenCalled();
    });

    it('should handle global "all" session', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: {
          active: true,
          sessions: [
            {
              userId: '123456789',
              personalityId: 'all',
              enabledAt: '2026-01-15T11:00:00Z',
              expiresAt: null,
              duration: 'forever',
              timeRemaining: 'Until manually disabled',
            },
          ],
        },
      });

      const context = createMockContext({});
      await handleIncognitoStatus(context);

      // 'all' doesn't call getPersonalityName
      expect(mockGetPersonalityName).not.toHaveBeenCalled();
      expect(mockCreateWarningEmbed).toHaveBeenCalledWith(
        '👻 Incognito Active',
        expect.stringContaining('all personalities')
      );
    });

    it('should handle API error', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: false,
        status: 500,
        error: 'Server error',
      });

      const context = createMockContext({});
      await handleIncognitoStatus(context);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Failed to check incognito status'),
      });
    });

    it('should handle exceptions', async () => {
      const error = new Error('Network error');
      mockCallGatewayApi.mockRejectedValue(error);

      const context = createMockContext({});
      await handleIncognitoStatus(context);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('unexpected error'),
      });
    });
  });

  describe('handleIncognitoForget', () => {
    it('should delete recent memories successfully', async () => {
      mockResolvePersonalityId.mockResolvedValue('personality-uuid-123');
      mockGetPersonalityName.mockResolvedValue('Lilith');
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: {
          deletedCount: 5,
          personalities: ['Lilith'],
          message: 'Deleted 5 memories from the last 15m',
        },
      });

      const context = createMockContext({ personality: 'lilith', timeframe: '15m' });
      await handleIncognitoForget(context);

      expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/memory/incognito/forget', {
        userId: '123456789',
        method: 'POST',
        body: { personalityId: 'personality-uuid-123', timeframe: '15m' },
      });
      expect(mockCreateSuccessEmbed).toHaveBeenCalledWith(
        '🗑️ Memories Deleted',
        expect.stringContaining('5 memories')
      );
    });

    it('should delete memories for all personalities', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: {
          deletedCount: 12,
          personalities: ['Lilith', 'Sarcastic', 'Sage'],
          message: 'Deleted 12 memories from the last 1h',
        },
      });

      const context = createMockContext({ personality: 'all', timeframe: '1h' });
      await handleIncognitoForget(context);

      expect(mockResolvePersonalityId).not.toHaveBeenCalled();
      expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/memory/incognito/forget', {
        userId: '123456789',
        method: 'POST',
        body: { personalityId: 'all', timeframe: '1h' },
      });
    });

    it('should show info when no memories found', async () => {
      mockResolvePersonalityId.mockResolvedValue('personality-uuid-123');
      mockGetPersonalityName.mockResolvedValue('Lilith');
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: {
          deletedCount: 0,
          personalities: [],
          message: 'No memories found in the last 5m',
        },
      });

      const context = createMockContext({ personality: 'lilith', timeframe: '5m' });
      await handleIncognitoForget(context);

      expect(mockCreateInfoEmbed).toHaveBeenCalledWith(
        '🗑️ No Memories Found',
        expect.stringContaining('No unlocked memories')
      );
    });

    it('should handle personality not found', async () => {
      mockResolvePersonalityId.mockResolvedValue(null);

      const context = createMockContext({ personality: 'unknown' });
      await handleIncognitoForget(context);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('unknown'),
      });
      expect(mockCallGatewayApi).not.toHaveBeenCalled();
    });

    it('should handle API error', async () => {
      mockResolvePersonalityId.mockResolvedValue('personality-uuid-123');
      mockCallGatewayApi.mockResolvedValue({
        ok: false,
        status: 500,
        error: 'Server error',
      });

      const context = createMockContext({ personality: 'lilith' });
      await handleIncognitoForget(context);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Failed to delete recent memories'),
      });
    });

    it('should handle exceptions', async () => {
      const error = new Error('Network error');
      mockResolvePersonalityId.mockRejectedValue(error);

      const context = createMockContext({ personality: 'lilith' });
      await handleIncognitoForget(context);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('unexpected error'),
      });
    });
  });
});
