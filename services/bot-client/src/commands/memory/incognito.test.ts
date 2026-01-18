/**
 * Tests for Memory Incognito Mode Handlers
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

// Mock commandHelpers
const mockReplyWithError = vi.fn();
const mockHandleCommandError = vi.fn();
const mockCreateSuccessEmbed = vi.fn(() => ({}));
const mockCreateInfoEmbed = vi.fn(() => ({}));
const mockCreateWarningEmbed = vi.fn(() => ({}));
vi.mock('../../utils/commandHelpers.js', () => ({
  replyWithError: (...args: unknown[]) => mockReplyWithError(...args),
  handleCommandError: (...args: unknown[]) => mockHandleCommandError(...args),
  createSuccessEmbed: (...args: unknown[]) => mockCreateSuccessEmbed(...args),
  createInfoEmbed: (...args: unknown[]) => mockCreateInfoEmbed(...args),
  createWarningEmbed: (...args: unknown[]) => mockCreateWarningEmbed(...args),
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

  // Helper to create mock interactions with different options
  function createMockInteraction(options: {
    personality?: string;
    duration?: string;
    timeframe?: string;
  }) {
    return {
      user: { id: '123456789' },
      options: {
        getString: (name: string, _required?: boolean) => {
          if (name === 'personality') return options.personality ?? 'lilith';
          if (name === 'duration') return options.duration ?? '1h';
          if (name === 'timeframe') return options.timeframe ?? '15m';
          return null;
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
          message: 'Incognito mode enabled for Lilith (1 hour)',
        },
      });

      const interaction = createMockInteraction({ personality: 'lilith', duration: '1h' });
      await handleIncognitoEnable(interaction);

      expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/memory/incognito', {
        userId: '123456789',
        method: 'POST',
        body: { personalityId: 'personality-uuid-123', duration: '1h' },
      });
      expect(mockCreateSuccessEmbed).toHaveBeenCalledWith(
        '👻 Incognito Mode Enabled',
        expect.stringContaining('enabled')
      );
      expect(mockEditReply).toHaveBeenCalled();
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
          message: 'Incognito mode enabled for all personalities',
        },
      });

      const interaction = createMockInteraction({ personality: 'all', duration: 'forever' });
      await handleIncognitoEnable(interaction);

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
          message: 'Incognito mode is already active for Lilith',
        },
      });

      const interaction = createMockInteraction({ personality: 'lilith' });
      await handleIncognitoEnable(interaction);

      expect(mockCreateInfoEmbed).toHaveBeenCalledWith(
        '👻 Incognito Already Active',
        expect.stringContaining('already active')
      );
    });

    it('should handle personality not found', async () => {
      mockResolvePersonalityId.mockResolvedValue(null);

      const interaction = createMockInteraction({ personality: 'unknown' });
      await handleIncognitoEnable(interaction);

      expect(mockReplyWithError).toHaveBeenCalledWith(
        interaction,
        expect.stringContaining('unknown')
      );
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

      const interaction = createMockInteraction({ personality: 'lilith' });
      await handleIncognitoEnable(interaction);

      expect(mockReplyWithError).toHaveBeenCalledWith(
        interaction,
        expect.stringContaining('Failed to enable incognito mode')
      );
    });

    it('should handle exceptions', async () => {
      const error = new Error('Network error');
      mockResolvePersonalityId.mockRejectedValue(error);

      const interaction = createMockInteraction({ personality: 'lilith' });
      await handleIncognitoEnable(interaction);

      expect(mockHandleCommandError).toHaveBeenCalledWith(interaction, error, {
        userId: '123456789',
        command: 'Memory Incognito Enable',
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

      const interaction = createMockInteraction({ personality: 'lilith' });
      await handleIncognitoDisable(interaction);

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

      const interaction = createMockInteraction({ personality: 'all' });
      await handleIncognitoDisable(interaction);

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

      const interaction = createMockInteraction({ personality: 'lilith' });
      await handleIncognitoDisable(interaction);

      expect(mockCreateInfoEmbed).toHaveBeenCalledWith(
        '👻 Incognito Not Active',
        expect.stringContaining('was not active')
      );
    });

    it('should handle personality not found', async () => {
      mockResolvePersonalityId.mockResolvedValue(null);

      const interaction = createMockInteraction({ personality: 'unknown' });
      await handleIncognitoDisable(interaction);

      expect(mockReplyWithError).toHaveBeenCalledWith(
        interaction,
        expect.stringContaining('unknown')
      );
    });

    it('should handle API error', async () => {
      mockResolvePersonalityId.mockResolvedValue('personality-uuid-123');
      mockCallGatewayApi.mockResolvedValue({
        ok: false,
        status: 500,
        error: 'Server error',
      });

      const interaction = createMockInteraction({ personality: 'lilith' });
      await handleIncognitoDisable(interaction);

      expect(mockReplyWithError).toHaveBeenCalledWith(
        interaction,
        expect.stringContaining('Failed to disable incognito mode')
      );
    });

    it('should handle exceptions', async () => {
      const error = new Error('Network error');
      mockResolvePersonalityId.mockRejectedValue(error);

      const interaction = createMockInteraction({ personality: 'lilith' });
      await handleIncognitoDisable(interaction);

      expect(mockHandleCommandError).toHaveBeenCalledWith(interaction, error, {
        userId: '123456789',
        command: 'Memory Incognito Disable',
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

      const interaction = createMockInteraction({});
      await handleIncognitoStatus(interaction);

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

      const interaction = createMockInteraction({});
      await handleIncognitoStatus(interaction);

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

      const interaction = createMockInteraction({});
      await handleIncognitoStatus(interaction);

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

      const interaction = createMockInteraction({});
      await handleIncognitoStatus(interaction);

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

      const interaction = createMockInteraction({});
      await handleIncognitoStatus(interaction);

      expect(mockReplyWithError).toHaveBeenCalledWith(
        interaction,
        expect.stringContaining('Failed to check incognito status')
      );
    });

    it('should handle exceptions', async () => {
      const error = new Error('Network error');
      mockCallGatewayApi.mockRejectedValue(error);

      const interaction = createMockInteraction({});
      await handleIncognitoStatus(interaction);

      expect(mockHandleCommandError).toHaveBeenCalledWith(interaction, error, {
        userId: '123456789',
        command: 'Memory Incognito Status',
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

      const interaction = createMockInteraction({ personality: 'lilith', timeframe: '15m' });
      await handleIncognitoForget(interaction);

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

      const interaction = createMockInteraction({ personality: 'all', timeframe: '1h' });
      await handleIncognitoForget(interaction);

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

      const interaction = createMockInteraction({ personality: 'lilith', timeframe: '5m' });
      await handleIncognitoForget(interaction);

      expect(mockCreateInfoEmbed).toHaveBeenCalledWith(
        '🗑️ No Memories Found',
        expect.stringContaining('No unlocked memories')
      );
    });

    it('should handle personality not found', async () => {
      mockResolvePersonalityId.mockResolvedValue(null);

      const interaction = createMockInteraction({ personality: 'unknown' });
      await handleIncognitoForget(interaction);

      expect(mockReplyWithError).toHaveBeenCalledWith(
        interaction,
        expect.stringContaining('unknown')
      );
      expect(mockCallGatewayApi).not.toHaveBeenCalled();
    });

    it('should handle API error', async () => {
      mockResolvePersonalityId.mockResolvedValue('personality-uuid-123');
      mockCallGatewayApi.mockResolvedValue({
        ok: false,
        status: 500,
        error: 'Server error',
      });

      const interaction = createMockInteraction({ personality: 'lilith' });
      await handleIncognitoForget(interaction);

      expect(mockReplyWithError).toHaveBeenCalledWith(
        interaction,
        expect.stringContaining('Failed to delete recent memories')
      );
    });

    it('should handle exceptions', async () => {
      const error = new Error('Network error');
      mockResolvePersonalityId.mockRejectedValue(error);

      const interaction = createMockInteraction({ personality: 'lilith' });
      await handleIncognitoForget(interaction);

      expect(mockHandleCommandError).toHaveBeenCalledWith(interaction, error, {
        userId: '123456789',
        command: 'Memory Incognito Forget',
      });
    });
  });
});
