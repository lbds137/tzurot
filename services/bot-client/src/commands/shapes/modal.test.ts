/**
 * Tests for Shapes Modal Submit Handler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageFlags } from 'discord.js';
import { handleShapesModalSubmit } from './modal.js';
import { makeOk, makeErr, asUserClient } from '../../test/gatewayClientStubs.js';

// Mock common-types — keep parseShapesSessionCookieInput real so we test the
// integration between modal handler and parser.
vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
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

const clientsForMock = vi.hoisted(() => vi.fn());
vi.mock('../../utils/gatewayClients.js', () => ({
  clientsFor: clientsForMock,
}));

// A long-enough alphanumeric token that passes the parser's shape + length check.
const VALID_TOKEN = 'abcdefghijklmnopqrstuvwxyz0123456789.ABCDEF';
const SESSION_COOKIE_NAME = '__Secure-better-auth.session_token';
const NORMALIZED_COOKIE = `${SESSION_COOKIE_NAME}=${VALID_TOKEN}`;

describe('handleShapesModalSubmit', () => {
  const mockReply = vi.fn();
  const mockDeferReply = vi.fn();
  const mockEditReply = vi.fn();
  let stub: { storeShapesAuth: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    stub = { storeShapesAuth: vi.fn() };
    clientsForMock.mockReturnValue({ userClient: asUserClient(stub) });
  });

  function createMockInteraction(customId: string, cookieValue: string = VALID_TOKEN) {
    return {
      customId,
      user: { id: '123456789', username: 'testuser' },
      fields: {
        getTextInputValue: (fieldId: string) => {
          if (fieldId === 'cookieValue') return cookieValue;
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

  describe('Input parsing', () => {
    it('should reject an empty cookie value', async () => {
      const interaction = createMockInteraction('shapes::auth', '   ');
      await handleShapesModalSubmit(interaction);

      expect(mockDeferReply).toHaveBeenCalled();
      expect(mockEditReply).toHaveBeenCalledWith(expect.stringContaining('required'));
    });

    it('should reject input that is a cookie string without the Better Auth name', async () => {
      const interaction = createMockInteraction('shapes::auth', 'appSession=legacy-auth0-value');
      await handleShapesModalSubmit(interaction);

      expect(mockEditReply).toHaveBeenCalledWith(
        expect.stringContaining("doesn't look like the right cookie")
      );
      expect(stub.storeShapesAuth).not.toHaveBeenCalled();
    });

    it('should reject input that looks like a full Cookie: header paste without the expected cookie', async () => {
      const interaction = createMockInteraction(
        'shapes::auth',
        '_ga=GA1.1.123; theme=dark; cf_clearance=abc'
      );
      await handleShapesModalSubmit(interaction);

      expect(mockEditReply).toHaveBeenCalledWith(
        expect.stringContaining("doesn't look like the right cookie")
      );
      expect(stub.storeShapesAuth).not.toHaveBeenCalled();
    });

    it('should reject a bare token value that fails the shape/length check', async () => {
      const interaction = createMockInteraction('shapes::auth', 'tooShort');
      await handleShapesModalSubmit(interaction);

      expect(mockEditReply).toHaveBeenCalledWith(expect.stringContaining('malformed'));
      expect(stub.storeShapesAuth).not.toHaveBeenCalled();
    });
  });

  describe('Gateway API interaction', () => {
    it('should send a normalized cookie to the gateway when given a bare token value', async () => {
      stub.storeShapesAuth.mockResolvedValue(makeOk({ success: true }));

      const interaction = createMockInteraction('shapes::auth', VALID_TOKEN);
      await handleShapesModalSubmit(interaction);

      expect(stub.storeShapesAuth).toHaveBeenCalledWith({ sessionCookie: NORMALIZED_COOKIE });
    });

    it('should send a normalized cookie when the user pastes name=value form', async () => {
      stub.storeShapesAuth.mockResolvedValue(makeOk({ success: true }));

      const interaction = createMockInteraction('shapes::auth', NORMALIZED_COOKIE);
      await handleShapesModalSubmit(interaction);

      expect(stub.storeShapesAuth).toHaveBeenCalledWith({ sessionCookie: NORMALIZED_COOKIE });
    });

    it('should extract the session cookie from a full Cookie: header paste', async () => {
      stub.storeShapesAuth.mockResolvedValue(makeOk({ success: true }));

      const fullHeader = `_ga=GA1.1.123; ${NORMALIZED_COOKIE}; theme=dark`;
      const interaction = createMockInteraction('shapes::auth', fullHeader);
      await handleShapesModalSubmit(interaction);

      expect(stub.storeShapesAuth).toHaveBeenCalledWith({ sessionCookie: NORMALIZED_COOKIE });
    });

    it('should show success embed on successful storage', async () => {
      stub.storeShapesAuth.mockResolvedValue(makeOk({ success: true }));

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

    it('should handle a 400 invalid-cookie error from the gateway', async () => {
      stub.storeShapesAuth.mockResolvedValue(makeErr(400, 'Validation error'));

      const interaction = createMockInteraction('shapes::auth');
      await handleShapesModalSubmit(interaction);

      expect(mockEditReply).toHaveBeenCalledWith(expect.stringContaining('Invalid Cookie'));
    });

    it('should handle a 500 server error from the gateway', async () => {
      stub.storeShapesAuth.mockResolvedValue(makeErr(500, 'Internal error'));

      const interaction = createMockInteraction('shapes::auth');
      await handleShapesModalSubmit(interaction);

      expect(mockEditReply).toHaveBeenCalledWith(expect.stringContaining('Server Error'));
    });

    it('should handle a network error gracefully', async () => {
      stub.storeShapesAuth.mockRejectedValue(new Error('Network error'));

      const interaction = createMockInteraction('shapes::auth');
      await handleShapesModalSubmit(interaction);

      expect(mockEditReply).toHaveBeenCalledWith(expect.stringContaining('unexpected error'));
    });
  });
});
