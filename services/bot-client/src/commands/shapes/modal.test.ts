/**
 * Tests for Shapes Modal Submit Handler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageFlags } from 'discord.js';
import { handleShapesModalSubmit } from './modal.js';

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

// Mock gateway client
const mockCallGatewayApi = vi.fn();
vi.mock('../../utils/userGatewayClient.js', () => ({
  callGatewayApi: (...args: unknown[]) => mockCallGatewayApi(...args),
  GATEWAY_TIMEOUTS: { DEFERRED: 15000 },
}));

describe('handleShapesModalSubmit', () => {
  const mockReply = vi.fn();
  const mockDeferReply = vi.fn();
  const mockEditReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createMockInteraction(
    customId: string,
    cookiePart0: string = 'cookie-part-0-value',
    cookiePart1: string = 'cookie-part-1-value'
  ) {
    return {
      customId,
      user: { id: '123456789' },
      fields: {
        getTextInputValue: (fieldId: string) => {
          if (fieldId === 'cookiePart0') return cookiePart0;
          if (fieldId === 'cookiePart1') return cookiePart1;
          return '';
        },
      },
      reply: mockReply,
      deferReply: mockDeferReply,
      editReply: mockEditReply,
    } as unknown as Parameters<typeof handleShapesModalSubmit>[0];
  }

  describe('Modal routing', () => {
    it('should reject unknown custom ID format', async () => {
      const interaction = createMockInteraction('unknown-modal');
      await handleShapesModalSubmit(interaction);

      expect(mockReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Unknown shapes modal'),
        flags: MessageFlags.Ephemeral,
      });
    });

    it('should reject unknown shapes action', async () => {
      const interaction = createMockInteraction('shapes::unknown');
      await handleShapesModalSubmit(interaction);

      expect(mockReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Unknown shapes action'),
        flags: MessageFlags.Ephemeral,
      });
    });
  });

  describe('Cookie validation', () => {
    it('should reject empty cookie part 0', async () => {
      const interaction = createMockInteraction('shapes::auth', '   ', 'valid-part');
      await handleShapesModalSubmit(interaction);

      expect(mockDeferReply).toHaveBeenCalled();
      expect(mockEditReply).toHaveBeenCalledWith(expect.stringContaining('Both cookie parts'));
    });

    it('should reject empty cookie part 1', async () => {
      const interaction = createMockInteraction('shapes::auth', 'valid-part', '  ');
      await handleShapesModalSubmit(interaction);

      expect(mockDeferReply).toHaveBeenCalled();
      expect(mockEditReply).toHaveBeenCalledWith(expect.stringContaining('Both cookie parts'));
    });
  });

  describe('Gateway API interaction', () => {
    it('should send combined cookie to gateway', async () => {
      mockCallGatewayApi.mockResolvedValue({ ok: true, data: { success: true } });

      const interaction = createMockInteraction('shapes::auth', 'part0-value', 'part1-value');
      await handleShapesModalSubmit(interaction);

      expect(mockCallGatewayApi).toHaveBeenCalledWith(
        '/user/shapes/auth',
        expect.objectContaining({
          method: 'POST',
          userId: '123456789',
          body: {
            sessionCookie: 'appSession.0=part0-value; appSession.1=part1-value',
          },
        })
      );
    });

    it('should show success embed on successful storage', async () => {
      mockCallGatewayApi.mockResolvedValue({ ok: true, data: { success: true } });

      const interaction = createMockInteraction('shapes::auth');
      await handleShapesModalSubmit(interaction);

      expect(mockEditReply).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            data: expect.objectContaining({
              title: expect.stringContaining('Authenticated'),
            }),
          }),
        ],
      });
    });

    it('should handle 400 invalid cookie error', async () => {
      mockCallGatewayApi.mockResolvedValue({ ok: false, status: 400, error: 'Validation error' });

      const interaction = createMockInteraction('shapes::auth');
      await handleShapesModalSubmit(interaction);

      expect(mockEditReply).toHaveBeenCalledWith(expect.stringContaining('Invalid Cookie'));
    });

    it('should handle 500 server error', async () => {
      mockCallGatewayApi.mockResolvedValue({ ok: false, status: 500, error: 'Internal error' });

      const interaction = createMockInteraction('shapes::auth');
      await handleShapesModalSubmit(interaction);

      expect(mockEditReply).toHaveBeenCalledWith(expect.stringContaining('Server Error'));
    });

    it('should handle network errors gracefully', async () => {
      mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

      const interaction = createMockInteraction('shapes::auth');
      await handleShapesModalSubmit(interaction);

      expect(mockEditReply).toHaveBeenCalledWith(expect.stringContaining('unexpected error'));
    });
  });
});
