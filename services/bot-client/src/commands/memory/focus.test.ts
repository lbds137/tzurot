/**
 * Tests for Memory Focus Mode Handlers
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleFocusEnable, handleFocusDisable, handleFocusStatus } from './focus.js';

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
const mockCreateSuccessEmbed = vi.fn(() => ({}));
const mockCreateInfoEmbed = vi.fn(() => ({}));
vi.mock('../../utils/commandHelpers.js', () => ({
  createSuccessEmbed: (...args: unknown[]) =>
    mockCreateSuccessEmbed(...(args as Parameters<typeof mockCreateSuccessEmbed>)),
  createInfoEmbed: (...args: unknown[]) =>
    mockCreateInfoEmbed(...(args as Parameters<typeof mockCreateInfoEmbed>)),
}));

// Mock autocomplete
const mockResolvePersonalityId = vi.fn();
const mockGetPersonalityName = vi.fn();
vi.mock('./autocomplete.js', () => ({
  resolvePersonalityId: (...args: unknown[]) => mockResolvePersonalityId(...args),
  getPersonalityName: (...args: unknown[]) => mockGetPersonalityName(...args),
}));

describe('Memory Focus Handlers', () => {
  const mockEditReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createMockContext(personalitySlug: string = 'lilith') {
    return {
      user: { id: '123456789' },
      interaction: {
        options: {
          getString: (name: string, _required?: boolean) => {
            if (name === 'personality') return personalitySlug;
            return null;
          },
        },
      },
      editReply: mockEditReply,
    } as unknown as Parameters<typeof handleFocusEnable>[0];
  }

  describe('handleFocusEnable', () => {
    it('should enable focus mode successfully', async () => {
      mockResolvePersonalityId.mockResolvedValue('personality-uuid-123');
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: {
          personalityId: 'personality-uuid-123',
          personalityName: 'Lilith',
          focusModeEnabled: true,
        },
      });

      const context = createMockContext();
      await handleFocusEnable(context);

      expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/memory/focus', {
        userId: '123456789',
        method: 'POST',
        body: { personalityId: 'personality-uuid-123', enabled: true },
      });
      expect(mockCreateSuccessEmbed).toHaveBeenCalledWith(
        'Focus Mode Enabled',
        expect.stringContaining('enabled')
      );
      expect(mockEditReply).toHaveBeenCalled();
    });

    it('should handle personality not found', async () => {
      mockResolvePersonalityId.mockResolvedValue(null);

      const context = createMockContext('unknown');
      await handleFocusEnable(context);

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

      const context = createMockContext();
      await handleFocusEnable(context);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Failed to update focus mode'),
      });
    });

    it('should handle exceptions', async () => {
      mockResolvePersonalityId.mockRejectedValue(new Error('Network error'));

      const context = createMockContext();
      await handleFocusEnable(context);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('unexpected error'),
      });
    });
  });

  describe('handleFocusDisable', () => {
    it('should disable focus mode successfully', async () => {
      mockResolvePersonalityId.mockResolvedValue('personality-uuid-123');
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: {
          personalityId: 'personality-uuid-123',
          personalityName: 'Lilith',
          focusModeEnabled: false,
        },
      });

      const context = createMockContext();
      await handleFocusDisable(context);

      expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/memory/focus', {
        userId: '123456789',
        method: 'POST',
        body: { personalityId: 'personality-uuid-123', enabled: false },
      });
      expect(mockCreateSuccessEmbed).toHaveBeenCalledWith(
        'Focus Mode Disabled',
        expect.stringContaining('disabled')
      );
    });

    it('should handle personality not found', async () => {
      mockResolvePersonalityId.mockResolvedValue(null);

      const context = createMockContext('unknown');
      await handleFocusDisable(context);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('unknown'),
      });
      expect(mockCallGatewayApi).not.toHaveBeenCalled();
    });
  });

  describe('handleFocusStatus', () => {
    it('should show status when focus mode is enabled', async () => {
      mockResolvePersonalityId.mockResolvedValue('personality-uuid-123');
      mockGetPersonalityName.mockResolvedValue('Lilith');
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: {
          personalityId: 'personality-uuid-123',
          focusModeEnabled: true,
        },
      });

      const context = createMockContext();
      await handleFocusStatus(context);

      expect(mockCallGatewayApi).toHaveBeenCalledWith(
        '/user/memory/focus?personalityId=personality-uuid-123',
        { userId: '123456789', method: 'GET' }
      );
      expect(mockCreateInfoEmbed).toHaveBeenCalledWith(
        'Focus Mode Status',
        expect.stringContaining('enabled')
      );
    });

    it('should show status when focus mode is disabled', async () => {
      mockResolvePersonalityId.mockResolvedValue('personality-uuid-123');
      mockGetPersonalityName.mockResolvedValue('Lilith');
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: {
          personalityId: 'personality-uuid-123',
          focusModeEnabled: false,
        },
      });

      const context = createMockContext();
      await handleFocusStatus(context);

      expect(mockCreateInfoEmbed).toHaveBeenCalledWith(
        'Focus Mode Status',
        expect.stringContaining('disabled')
      );
    });

    it('should use personality slug when name not found', async () => {
      mockResolvePersonalityId.mockResolvedValue('personality-uuid-123');
      mockGetPersonalityName.mockResolvedValue(null);
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: {
          personalityId: 'personality-uuid-123',
          focusModeEnabled: false,
        },
      });

      const context = createMockContext('lilith');
      await handleFocusStatus(context);

      expect(mockCreateInfoEmbed).toHaveBeenCalledWith(
        'Focus Mode Status',
        expect.stringContaining('lilith')
      );
    });

    it('should handle personality not found', async () => {
      mockResolvePersonalityId.mockResolvedValue(null);

      const context = createMockContext('unknown');
      await handleFocusStatus(context);

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

      const context = createMockContext();
      await handleFocusStatus(context);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Failed to check focus mode'),
      });
    });

    it('should handle exceptions', async () => {
      mockResolvePersonalityId.mockRejectedValue(new Error('Network error'));

      const context = createMockContext();
      await handleFocusStatus(context);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('unexpected error'),
      });
    });
  });
});
