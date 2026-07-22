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
import { makeOk, makeErr, asUserClient } from '../../test/gatewayClientStubs.js';
import { GatewayApiError } from '@tzurot/clients';

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

const mockResolvePersonalityId = vi.fn();
const mockGetPersonalityName = vi.fn();
vi.mock('./autocomplete.js', () => ({
  resolvePersonalityId: (...args: unknown[]) => mockResolvePersonalityId(...args),
  getPersonalityName: (...args: unknown[]) => mockGetPersonalityName(...args),
}));

interface MemoryClientStub {
  getIncognitoStatus: ReturnType<typeof vi.fn>;
  enableIncognito: ReturnType<typeof vi.fn>;
  disableIncognito: ReturnType<typeof vi.fn>;
  incognitoForget: ReturnType<typeof vi.fn>;
}

function createStub(): MemoryClientStub {
  return {
    getIncognitoStatus: vi.fn(),
    enableIncognito: vi.fn(),
    disableIncognito: vi.fn(),
    incognitoForget: vi.fn(),
  };
}

describe('Memory Incognito Handlers', () => {
  const mockEditReply = vi.fn();
  let stub: MemoryClientStub;

  beforeEach(() => {
    vi.clearAllMocks();
    stub = createStub();
    clientsForMock.mockReturnValue({ userClient: asUserClient(stub) });
  });

  function createMockContext(options: {
    character?: string | null;
    duration?: string;
    timeframe?: string;
  }) {
    return {
      user: { id: '123456789', username: 'testuser' },
      interaction: {
        user: { id: '123456789', username: 'testuser' },
        options: {
          getString: (name: string, _required?: boolean) => {
            if (name === 'character')
              return options.character === undefined ? 'lilith' : options.character;
            // Both enable (duration semantics) and forget (window semantics)
            // now share the §4.2 `timeframe` option name.
            if (name === 'timeframe') return options.duration ?? options.timeframe ?? '1h';
            return null;
          },
        },
      },
      editReply: mockEditReply,
    } as unknown as Parameters<typeof handleIncognitoEnable>[0];
  }

  describe('handleIncognitoEnable', () => {
    it('should enable incognito mode for specific personality', async () => {
      mockResolvePersonalityId.mockResolvedValue({ kind: 'found', id: 'personality-uuid-123' });
      mockGetPersonalityName.mockResolvedValue('Lilith');
      stub.enableIncognito.mockResolvedValue(
        makeOk({
          session: {
            user: {
              discordId: '123456789',
              username: 'testuser',
              displayName: 'testuser',
            },
            personalityId: 'personality-uuid-123',
            enabledAt: '2026-01-15T12:00:00Z',
            expiresAt: '2026-01-15T13:00:00Z',
            duration: '1h',
          },
          timeRemaining: '1h remaining',
          wasAlreadyActive: false,
          message: 'Incognito mode enabled for Lilith (1 hour)',
        })
      );

      const context = createMockContext({ character: 'lilith', duration: '1h' });
      await handleIncognitoEnable(context);

      expect(stub.enableIncognito).toHaveBeenCalledWith({
        personalityId: 'personality-uuid-123',
        duration: '1h',
      });
      expect(mockCreateSuccessEmbed).toHaveBeenCalledWith(
        '👻 Incognito Mode Enabled',
        expect.stringContaining('enabled')
      );
      expect(mockEditReply).toHaveBeenCalledWith({ embeds: [expect.anything()] });
    });

    it('should enable incognito mode for all personalities', async () => {
      // 'all' is handled specially - no resolvePersonalityId call
      stub.enableIncognito.mockResolvedValue(
        makeOk({
          session: {
            user: {
              discordId: '123456789',
              username: 'testuser',
              displayName: 'testuser',
            },
            personalityId: 'all',
            enabledAt: '2026-01-15T12:00:00Z',
            expiresAt: null,
            duration: 'forever',
          },
          timeRemaining: 'Until manually disabled',
          wasAlreadyActive: false,
          message: 'Incognito mode enabled for all personalities',
        })
      );

      const context = createMockContext({ character: 'all', duration: 'forever' });
      await handleIncognitoEnable(context);

      expect(mockResolvePersonalityId).not.toHaveBeenCalled();
      expect(stub.enableIncognito).toHaveBeenCalledWith({
        personalityId: 'all',
        duration: 'forever',
      });
      expect(mockCreateSuccessEmbed).toHaveBeenCalled();
    });

    it('should show info embed when already active', async () => {
      mockResolvePersonalityId.mockResolvedValue({ kind: 'found', id: 'personality-uuid-123' });
      mockGetPersonalityName.mockResolvedValue('Lilith');
      stub.enableIncognito.mockResolvedValue(
        makeOk({
          session: {
            user: {
              discordId: '123456789',
              username: 'testuser',
              displayName: 'testuser',
            },
            personalityId: 'personality-uuid-123',
            enabledAt: '2026-01-15T11:00:00Z',
            expiresAt: '2026-01-15T12:00:00Z',
            duration: '1h',
          },
          timeRemaining: '30m remaining',
          wasAlreadyActive: true,
          message: 'Incognito mode is already active for Lilith',
        })
      );

      const context = createMockContext({ character: 'lilith' });
      await handleIncognitoEnable(context);

      expect(mockCreateInfoEmbed).toHaveBeenCalledWith(
        '👻 Incognito Already Active',
        expect.stringContaining('already active')
      );
    });

    it('should handle personality not found', async () => {
      mockResolvePersonalityId.mockResolvedValue({ kind: 'not-found' });

      const context = createMockContext({ character: 'unknown' });
      await handleIncognitoEnable(context);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('unknown'),
      });
      expect(stub.enableIncognito).not.toHaveBeenCalled();
    });

    it('shows "try again" (unavailable), not "not found", on an infra failure', async () => {
      // The personality list couldn't be fetched — must NOT claim the character
      // doesn't exist.
      mockResolvePersonalityId.mockResolvedValue({ kind: 'unavailable' });

      const context = createMockContext({ character: 'lilith' });
      await handleIncognitoEnable(context);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Autocomplete was unavailable'),
      });
      expect(stub.enableIncognito).not.toHaveBeenCalled();
    });

    it('should handle API error', async () => {
      mockResolvePersonalityId.mockResolvedValue({ kind: 'found', id: 'personality-uuid-123' });
      mockGetPersonalityName.mockResolvedValue('Lilith');
      stub.enableIncognito.mockResolvedValue(makeErr(500, 'Server error'));

      const context = createMockContext({ character: 'lilith' });
      await handleIncognitoEnable(context);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Server error'),
      });
    });

    it('should handle exceptions', async () => {
      const error = new Error('Network error');
      mockResolvePersonalityId.mockRejectedValue(error);

      const context = createMockContext({ character: 'lilith' });
      await handleIncognitoEnable(context);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Failed to enable incognito mode'),
      });
    });

    it('a WRITE timeout renders the uncertain-write shape, never "try again"', async () => {
      // enableIncognito is a write inside the catch's try — a typed timeout
      // must render "may still be applying", not invite a duplicate write.
      mockResolvePersonalityId.mockResolvedValue({ kind: 'found', id: 'p1' });
      stub.enableIncognito.mockRejectedValue(
        new GatewayApiError('Failed to enable: 0 - timed out', 0, 'timeout')
      );

      const context = createMockContext({ character: 'lilith' });
      await handleIncognitoEnable(context);

      const reply = (mockEditReply as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as {
        content: string;
      };
      expect(reply.content).toContain('may still be applying');
      expect(reply.content).not.toMatch(/try again(?! later)/i);
    });

    it('rejects the autocomplete-error sentinel before calling resolver or gateway', async () => {
      const context = createMockContext({ character: '__autocomplete_error__' });
      await handleIncognitoEnable(context);

      expect(mockResolvePersonalityId).not.toHaveBeenCalled();
      expect(stub.enableIncognito).not.toHaveBeenCalled();
      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Autocomplete was unavailable'),
      });
    });
  });

  describe('handleIncognitoDisable', () => {
    it('should disable incognito mode successfully', async () => {
      mockResolvePersonalityId.mockResolvedValue({ kind: 'found', id: 'personality-uuid-123' });
      mockGetPersonalityName.mockResolvedValue('Lilith');
      stub.disableIncognito.mockResolvedValue(
        makeOk({
          disabled: true,
          message: 'Incognito mode disabled for Lilith',
        })
      );

      const context = createMockContext({ character: 'lilith' });
      await handleIncognitoDisable(context);

      expect(stub.disableIncognito).toHaveBeenCalledWith({
        personalityId: 'personality-uuid-123',
      });
      expect(mockCreateSuccessEmbed).toHaveBeenCalledWith(
        '👻 Incognito Mode Disabled',
        expect.stringContaining('disabled')
      );
    });

    it('should disable incognito for all personalities', async () => {
      stub.disableIncognito.mockResolvedValue(
        makeOk({
          disabled: true,
          message: 'Incognito mode disabled for all personalities',
        })
      );

      const context = createMockContext({ character: 'all' });
      await handleIncognitoDisable(context);

      expect(mockResolvePersonalityId).not.toHaveBeenCalled();
      expect(stub.disableIncognito).toHaveBeenCalledWith({ personalityId: 'all' });
    });

    it('should show info when incognito was not active', async () => {
      mockResolvePersonalityId.mockResolvedValue({ kind: 'found', id: 'personality-uuid-123' });
      mockGetPersonalityName.mockResolvedValue('Lilith');
      stub.disableIncognito.mockResolvedValue(
        makeOk({
          disabled: false,
          message: 'Incognito mode was not active for Lilith',
        })
      );

      const context = createMockContext({ character: 'lilith' });
      await handleIncognitoDisable(context);

      expect(mockCreateInfoEmbed).toHaveBeenCalledWith(
        '👻 Incognito Not Active',
        expect.stringContaining('was not active')
      );
    });

    it('should handle personality not found', async () => {
      mockResolvePersonalityId.mockResolvedValue({ kind: 'not-found' });

      const context = createMockContext({ character: 'unknown' });
      await handleIncognitoDisable(context);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('unknown'),
      });
    });

    it('shows "try again" (unavailable), not "not found", on an infra failure', async () => {
      mockResolvePersonalityId.mockResolvedValue({ kind: 'unavailable' });

      const context = createMockContext({ character: 'lilith' });
      await handleIncognitoDisable(context);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Autocomplete was unavailable'),
      });
      expect(stub.disableIncognito).not.toHaveBeenCalled();
    });

    it('should handle API error', async () => {
      mockResolvePersonalityId.mockResolvedValue({ kind: 'found', id: 'personality-uuid-123' });
      stub.disableIncognito.mockResolvedValue(makeErr(500, 'Server error'));

      const context = createMockContext({ character: 'lilith' });
      await handleIncognitoDisable(context);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Server error'),
      });
    });

    it('should handle exceptions', async () => {
      const error = new Error('Network error');
      mockResolvePersonalityId.mockRejectedValue(error);

      const context = createMockContext({ character: 'lilith' });
      await handleIncognitoDisable(context);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Failed to disable incognito mode'),
      });
    });

    it('rejects the autocomplete-error sentinel before calling resolver or gateway', async () => {
      const context = createMockContext({ character: '__autocomplete_error__' });
      await handleIncognitoDisable(context);

      expect(mockResolvePersonalityId).not.toHaveBeenCalled();
      expect(stub.disableIncognito).not.toHaveBeenCalled();
      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Autocomplete was unavailable'),
      });
    });
  });

  describe('handleIncognitoStatus', () => {
    it('should show inactive status when no sessions', async () => {
      stub.getIncognitoStatus.mockResolvedValue(
        makeOk({
          active: false,
          sessions: [],
        })
      );

      const context = createMockContext({ character: null });
      await handleIncognitoStatus(context);

      expect(mockCreateInfoEmbed).toHaveBeenCalledWith(
        '👻 Incognito Status',
        expect.stringContaining('not active')
      );
    });

    it('passes the resolved character as a status filter', async () => {
      mockResolvePersonalityId.mockResolvedValue({ kind: 'found', id: 'personality-uuid-123' });
      mockGetPersonalityName.mockResolvedValue('Lilith');
      stub.getIncognitoStatus.mockResolvedValue(makeOk({ active: false, sessions: [] }));

      const context = createMockContext({ character: 'lilith' });
      await handleIncognitoStatus(context);

      expect(stub.getIncognitoStatus).toHaveBeenCalledWith({
        personalityId: 'personality-uuid-123',
      });
    });

    it('should show active status with single session', async () => {
      mockGetPersonalityName.mockResolvedValue('Lilith');
      stub.getIncognitoStatus.mockResolvedValue(
        makeOk({
          active: true,
          sessions: [
            {
              user: {
                discordId: '123456789',
                username: 'testuser',
                displayName: 'testuser',
              },
              personalityId: 'personality-uuid-123',
              enabledAt: '2026-01-15T11:00:00Z',
              expiresAt: '2026-01-15T13:00:00Z',
              duration: '1h',
              timeRemaining: '1h remaining',
            },
          ],
        })
      );

      const context = createMockContext({ character: null });
      await handleIncognitoStatus(context);

      expect(mockCreateWarningEmbed).toHaveBeenCalledWith(
        '👻 Incognito Active',
        expect.stringContaining('active')
      );
    });

    it('should show active status with multiple sessions', async () => {
      mockGetPersonalityName.mockResolvedValueOnce('Lilith').mockResolvedValueOnce('Sarcastic');
      stub.getIncognitoStatus.mockResolvedValue(
        makeOk({
          active: true,
          sessions: [
            {
              user: {
                discordId: '123456789',
                username: 'testuser',
                displayName: 'testuser',
              },
              personalityId: 'personality-uuid-1',
              enabledAt: '2026-01-15T11:00:00Z',
              expiresAt: '2026-01-15T13:00:00Z',
              duration: '1h',
              timeRemaining: '1h remaining',
            },
            {
              user: {
                discordId: '123456789',
                username: 'testuser',
                displayName: 'testuser',
              },
              personalityId: 'personality-uuid-2',
              enabledAt: '2026-01-15T11:30:00Z',
              expiresAt: '2026-01-15T15:30:00Z',
              duration: '4h',
              timeRemaining: '3h 30m remaining',
            },
          ],
        })
      );

      const context = createMockContext({ character: null });
      await handleIncognitoStatus(context);

      expect(mockGetPersonalityName).toHaveBeenCalledTimes(2);
      expect(mockCreateWarningEmbed).toHaveBeenCalled();
    });

    it('should handle global "all" session', async () => {
      stub.getIncognitoStatus.mockResolvedValue(
        makeOk({
          active: true,
          sessions: [
            {
              user: {
                discordId: '123456789',
                username: 'testuser',
                displayName: 'testuser',
              },
              personalityId: 'all',
              enabledAt: '2026-01-15T11:00:00Z',
              expiresAt: null,
              duration: 'forever',
              timeRemaining: 'Until manually disabled',
            },
          ],
        })
      );

      const context = createMockContext({ character: null });
      await handleIncognitoStatus(context);

      // 'all' doesn't call getPersonalityName
      expect(mockGetPersonalityName).not.toHaveBeenCalled();
      expect(mockCreateWarningEmbed).toHaveBeenCalledWith(
        '👻 Incognito Active',
        expect.stringContaining('all characters')
      );
    });

    it('should handle API error', async () => {
      stub.getIncognitoStatus.mockResolvedValue(makeErr(500, 'Server error'));

      const context = createMockContext({ character: null });
      await handleIncognitoStatus(context);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Server error'),
      });
    });

    it('should handle exceptions', async () => {
      const error = new Error('Network error');
      stub.getIncognitoStatus.mockRejectedValue(error);

      const context = createMockContext({ character: null });
      await handleIncognitoStatus(context);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Failed to load the incognito status'),
      });
    });
  });

  describe('handleIncognitoForget', () => {
    it('should delete recent memories successfully', async () => {
      mockResolvePersonalityId.mockResolvedValue({ kind: 'found', id: 'personality-uuid-123' });
      mockGetPersonalityName.mockResolvedValue('Lilith');
      stub.incognitoForget.mockResolvedValue(
        makeOk({
          deletedCount: 5,
          personalities: ['Lilith'],
          message: 'Deleted 5 memories from the last 15m',
        })
      );

      const context = createMockContext({ character: 'lilith', timeframe: '15m' });
      await handleIncognitoForget(context);

      expect(stub.incognitoForget).toHaveBeenCalledWith({
        personalityId: 'personality-uuid-123',
        timeframe: '15m',
      });
      expect(mockCreateSuccessEmbed).toHaveBeenCalledWith(
        '🗑️ Memories Deleted',
        expect.stringContaining('5 memories')
      );
    });

    it('should delete memories for all personalities', async () => {
      stub.incognitoForget.mockResolvedValue(
        makeOk({
          deletedCount: 12,
          personalities: ['Lilith', 'Sarcastic', 'Sage'],
          message: 'Deleted 12 memories from the last 1h',
        })
      );

      const context = createMockContext({ character: 'all', timeframe: '1h' });
      await handleIncognitoForget(context);

      expect(mockResolvePersonalityId).not.toHaveBeenCalled();
      expect(stub.incognitoForget).toHaveBeenCalledWith({
        personalityId: 'all',
        timeframe: '1h',
      });
    });

    it('should show info when no memories found', async () => {
      mockResolvePersonalityId.mockResolvedValue({ kind: 'found', id: 'personality-uuid-123' });
      mockGetPersonalityName.mockResolvedValue('Lilith');
      stub.incognitoForget.mockResolvedValue(
        makeOk({
          deletedCount: 0,
          personalities: [],
          message: 'No memories found in the last 5m',
        })
      );

      const context = createMockContext({ character: 'lilith', timeframe: '5m' });
      await handleIncognitoForget(context);

      expect(mockCreateInfoEmbed).toHaveBeenCalledWith(
        '🗑️ No Memories Found',
        expect.stringContaining('No unlocked memories')
      );
    });

    it('should handle personality not found', async () => {
      mockResolvePersonalityId.mockResolvedValue({ kind: 'not-found' });

      const context = createMockContext({ character: 'unknown' });
      await handleIncognitoForget(context);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('unknown'),
      });
      expect(stub.incognitoForget).not.toHaveBeenCalled();
    });

    it('shows "try again" (unavailable), not "not found", on an infra failure', async () => {
      mockResolvePersonalityId.mockResolvedValue({ kind: 'unavailable' });

      const context = createMockContext({ character: 'lilith', timeframe: '5m' });
      await handleIncognitoForget(context);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Autocomplete was unavailable'),
      });
      expect(stub.incognitoForget).not.toHaveBeenCalled();
    });

    it('should handle API error', async () => {
      mockResolvePersonalityId.mockResolvedValue({ kind: 'found', id: 'personality-uuid-123' });
      stub.incognitoForget.mockResolvedValue(makeErr(500, 'Server error'));

      const context = createMockContext({ character: 'lilith' });
      await handleIncognitoForget(context);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Server error'),
      });
    });

    it('should handle exceptions', async () => {
      const error = new Error('Network error');
      mockResolvePersonalityId.mockRejectedValue(error);

      const context = createMockContext({ character: 'lilith' });
      await handleIncognitoForget(context);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Failed to delete recent memories'),
      });
    });

    it('rejects the autocomplete-error sentinel before calling resolver or gateway', async () => {
      const context = createMockContext({ character: '__autocomplete_error__' });
      await handleIncognitoForget(context);

      expect(mockResolvePersonalityId).not.toHaveBeenCalled();
      expect(stub.incognitoForget).not.toHaveBeenCalled();
      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Autocomplete was unavailable'),
      });
    });
  });
});
