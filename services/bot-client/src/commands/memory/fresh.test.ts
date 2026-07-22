/**
 * Tests for Memory Fresh Mode Handlers
 *
 * Fresh mode shares the target resolver + session formatting with incognito
 * (exported from incognito.ts); these tests pin the fresh-specific routing,
 * the "all" scope, the optional status filter, and the copy — which must make
 * "memories are kept, just not used" unmissable (owner condition on the
 * rename from focus mode).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleFreshEnable, handleFreshDisable, handleFreshStatus } from './fresh.js';
import { makeOk, makeErr, asUserClient } from '../../test/gatewayClientStubs.js';

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

interface FreshClientStub {
  getFreshStatus: ReturnType<typeof vi.fn>;
  enableFresh: ReturnType<typeof vi.fn>;
  disableFresh: ReturnType<typeof vi.fn>;
}

function createStub(): FreshClientStub {
  return {
    getFreshStatus: vi.fn(),
    enableFresh: vi.fn(),
    disableFresh: vi.fn(),
  };
}

function makeSession(personalityId: string) {
  return {
    userId: '123456789',
    personalityId,
    enabledAt: '2026-01-15T12:00:00Z',
    expiresAt: '2026-01-15T13:00:00Z',
    duration: '1h',
    timeRemaining: '1h remaining',
  };
}

describe('Memory Fresh Handlers', () => {
  const mockEditReply = vi.fn();
  let stub: FreshClientStub;

  beforeEach(() => {
    vi.clearAllMocks();
    stub = createStub();
    clientsForMock.mockReturnValue({ userClient: asUserClient(stub) });
  });

  function createMockContext(options: { character?: string; timeframe?: string }) {
    return {
      user: { id: '123456789', username: 'testuser' },
      interaction: {
        user: { id: '123456789', username: 'testuser' },
        options: {
          getString: (name: string, _required?: boolean) => {
            if (name === 'character') return options.character ?? null;
            if (name === 'timeframe') return options.timeframe ?? '1h';
            return null;
          },
        },
      },
      editReply: mockEditReply,
    } as unknown as Parameters<typeof handleFreshEnable>[0];
  }

  describe('handleFreshEnable', () => {
    it('enables fresh mode for a specific character with kept-not-used copy', async () => {
      mockResolvePersonalityId.mockResolvedValue({ kind: 'found', id: 'personality-uuid-123' });
      mockGetPersonalityName.mockResolvedValue('Lilith');
      stub.enableFresh.mockResolvedValue(
        makeOk({
          session: makeSession('personality-uuid-123'),
          timeRemaining: '1h remaining',
          wasAlreadyActive: false,
          message: 'Fresh mode enabled',
        })
      );

      await handleFreshEnable(createMockContext({ character: 'lilith', timeframe: '1h' }));

      expect(stub.enableFresh).toHaveBeenCalledWith({
        personalityId: 'personality-uuid-123',
        duration: '1h',
      });
      expect(mockCreateSuccessEmbed).toHaveBeenCalledWith(
        '🌱 Fresh Mode Enabled',
        expect.stringContaining('memories are kept')
      );
      expect(mockEditReply).toHaveBeenCalledWith({ embeds: [expect.anything()] });
    });

    it('supports the global "all" scope without resolving a personality', async () => {
      stub.enableFresh.mockResolvedValue(
        makeOk({
          session: makeSession('all'),
          timeRemaining: 'Until manually disabled',
          wasAlreadyActive: false,
          message: 'Fresh mode enabled',
        })
      );

      await handleFreshEnable(createMockContext({ character: 'all', timeframe: 'forever' }));

      expect(mockResolvePersonalityId).not.toHaveBeenCalled();
      expect(stub.enableFresh).toHaveBeenCalledWith({ personalityId: 'all', duration: 'forever' });
    });

    it('shows an info embed when already active', async () => {
      mockResolvePersonalityId.mockResolvedValue({ kind: 'found', id: 'personality-uuid-123' });
      mockGetPersonalityName.mockResolvedValue('Lilith');
      stub.enableFresh.mockResolvedValue(
        makeOk({
          session: makeSession('personality-uuid-123'),
          timeRemaining: '30m remaining',
          wasAlreadyActive: true,
          message: 'Already active',
        })
      );

      await handleFreshEnable(createMockContext({ character: 'lilith', timeframe: '1h' }));

      expect(mockCreateInfoEmbed).toHaveBeenCalledWith(
        '🌱 Fresh Mode Already Active',
        expect.stringContaining('30m remaining')
      );
    });

    it('renders the gateway failure shape on API error', async () => {
      mockResolvePersonalityId.mockResolvedValue({ kind: 'found', id: 'personality-uuid-123' });
      mockGetPersonalityName.mockResolvedValue('Lilith');
      stub.enableFresh.mockResolvedValue(makeErr(500));

      await handleFreshEnable(createMockContext({ character: 'lilith', timeframe: '1h' }));

      expect(mockEditReply).toHaveBeenCalledWith({ content: expect.any(String) });
      expect(mockCreateSuccessEmbed).not.toHaveBeenCalled();
    });
  });

  describe('handleFreshDisable', () => {
    it('disables fresh mode and says memories will be used again', async () => {
      mockResolvePersonalityId.mockResolvedValue({ kind: 'found', id: 'personality-uuid-123' });
      mockGetPersonalityName.mockResolvedValue('Lilith');
      stub.disableFresh.mockResolvedValue(makeOk({ disabled: true, message: 'Disabled' }));

      await handleFreshDisable(createMockContext({ character: 'lilith' }));

      expect(stub.disableFresh).toHaveBeenCalledWith({ personalityId: 'personality-uuid-123' });
      expect(mockCreateSuccessEmbed).toHaveBeenCalledWith(
        '🌱 Fresh Mode Disabled',
        expect.stringContaining('use their memories of you again')
      );
    });

    it('shows an info embed when the mode was not active', async () => {
      mockResolvePersonalityId.mockResolvedValue({ kind: 'found', id: 'personality-uuid-123' });
      mockGetPersonalityName.mockResolvedValue('Lilith');
      stub.disableFresh.mockResolvedValue(makeOk({ disabled: false, message: 'Not active' }));

      await handleFreshDisable(createMockContext({ character: 'lilith' }));

      expect(mockCreateInfoEmbed).toHaveBeenCalledWith(
        '🌱 Fresh Mode Not Active',
        expect.stringContaining('not active')
      );
    });
  });

  describe('handleFreshStatus', () => {
    it('shows inactive status when no sessions', async () => {
      stub.getFreshStatus.mockResolvedValue(makeOk({ active: false, sessions: [] }));

      await handleFreshStatus(createMockContext({}));

      expect(stub.getFreshStatus).toHaveBeenCalledWith({ personalityId: undefined });
      expect(mockCreateInfoEmbed).toHaveBeenCalledWith(
        '🌱 Fresh Mode Status',
        expect.stringContaining('not active')
      );
    });

    it('shows an overview of active sessions with kept-not-used copy', async () => {
      mockGetPersonalityName.mockResolvedValue('Lilith');
      stub.getFreshStatus.mockResolvedValue(
        makeOk({
          active: true,
          sessions: [makeSession('personality-uuid-123'), makeSession('all')],
        })
      );

      await handleFreshStatus(createMockContext({}));

      expect(mockCreateWarningEmbed).toHaveBeenCalledWith(
        '🌱 Fresh Mode Active',
        expect.stringContaining('Memories are kept')
      );
    });

    it('passes the resolved character as a status filter', async () => {
      mockResolvePersonalityId.mockResolvedValue({ kind: 'found', id: 'personality-uuid-123' });
      mockGetPersonalityName.mockResolvedValue('Lilith');
      stub.getFreshStatus.mockResolvedValue(makeOk({ active: false, sessions: [] }));

      await handleFreshStatus(createMockContext({ character: 'lilith' }));

      expect(stub.getFreshStatus).toHaveBeenCalledWith({ personalityId: 'personality-uuid-123' });
    });
  });
});
