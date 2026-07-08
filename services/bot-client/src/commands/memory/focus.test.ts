/**
 * Tests for Memory Focus Mode Handlers
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleFocusEnable, handleFocusDisable, handleFocusStatus } from './focus.js';
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

const mockCreateSuccessEmbed = vi.fn(() => ({}));
const mockCreateInfoEmbed = vi.fn(() => ({}));
vi.mock('../../utils/commandHelpers.js', () => ({
  createSuccessEmbed: (...args: unknown[]) =>
    mockCreateSuccessEmbed(...(args as Parameters<typeof mockCreateSuccessEmbed>)),
  createInfoEmbed: (...args: unknown[]) =>
    mockCreateInfoEmbed(...(args as Parameters<typeof mockCreateInfoEmbed>)),
}));

const mockResolvePersonalityId = vi.fn();
const mockGetPersonalityName = vi.fn();
vi.mock('./autocomplete.js', () => ({
  resolvePersonalityId: (...args: unknown[]) => mockResolvePersonalityId(...args),
  getPersonalityName: (...args: unknown[]) => mockGetPersonalityName(...args),
}));

interface MemoryClientStub {
  getFocus: ReturnType<typeof vi.fn>;
  setFocus: ReturnType<typeof vi.fn>;
}

function createStub(): MemoryClientStub {
  return {
    getFocus: vi.fn(),
    setFocus: vi.fn(),
  };
}

describe('Memory Focus Handlers', () => {
  const mockEditReply = vi.fn();
  let stub: MemoryClientStub;

  beforeEach(() => {
    vi.clearAllMocks();
    stub = createStub();
    clientsForMock.mockReturnValue({ userClient: asUserClient(stub) });
  });

  function createMockContext(personalitySlug: string = 'lilith') {
    return {
      user: { id: '123456789', username: 'testuser' },
      interaction: {
        user: { id: '123456789', username: 'testuser' },
        options: {
          getString: (name: string, _required?: boolean) => {
            if (name === 'character') return personalitySlug;
            return null;
          },
        },
      },
      editReply: mockEditReply,
    } as unknown as Parameters<typeof handleFocusEnable>[0];
  }

  describe('handleFocusEnable', () => {
    it('should enable focus mode successfully', async () => {
      mockResolvePersonalityId.mockResolvedValue({ kind: 'found', id: 'personality-uuid-123' });
      stub.setFocus.mockResolvedValue(
        makeOk({
          personalityId: 'personality-uuid-123',
          personalityName: 'Lilith',
          focusModeEnabled: true,
          message: 'Focus mode enabled',
        })
      );

      const context = createMockContext();
      await handleFocusEnable(context);

      expect(stub.setFocus).toHaveBeenCalledWith({
        personalityId: 'personality-uuid-123',
        enabled: true,
      });
      expect(mockCreateSuccessEmbed).toHaveBeenCalledWith(
        'Focus Mode Enabled',
        expect.stringContaining('enabled')
      );
      expect(mockEditReply).toHaveBeenCalled();
    });

    it('should handle personality not found', async () => {
      mockResolvePersonalityId.mockResolvedValue({ kind: 'not-found' });

      const context = createMockContext('unknown');
      await handleFocusEnable(context);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('unknown'),
      });
      expect(stub.setFocus).not.toHaveBeenCalled();
    });

    it('shows "try again" (unavailable), not "not found", when the personality list is unavailable', async () => {
      mockResolvePersonalityId.mockResolvedValue({ kind: 'unavailable' });

      const context = createMockContext('lilith');
      await handleFocusEnable(context);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Autocomplete was unavailable'),
      });
      expect(stub.setFocus).not.toHaveBeenCalled();
    });

    it('should handle API error', async () => {
      mockResolvePersonalityId.mockResolvedValue({ kind: 'found', id: 'personality-uuid-123' });
      stub.setFocus.mockResolvedValue(makeErr(500, 'Server error'));

      const context = createMockContext();
      await handleFocusEnable(context);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Server error'),
      });
    });

    it('should handle exceptions', async () => {
      mockResolvePersonalityId.mockRejectedValue(new Error('Network error'));

      const context = createMockContext();
      await handleFocusEnable(context);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Failed to update focus mode'),
      });
    });
  });

  describe('handleFocusDisable', () => {
    it('should disable focus mode successfully', async () => {
      mockResolvePersonalityId.mockResolvedValue({ kind: 'found', id: 'personality-uuid-123' });
      stub.setFocus.mockResolvedValue(
        makeOk({
          personalityId: 'personality-uuid-123',
          personalityName: 'Lilith',
          focusModeEnabled: false,
          message: 'Focus mode disabled',
        })
      );

      const context = createMockContext();
      await handleFocusDisable(context);

      expect(stub.setFocus).toHaveBeenCalledWith({
        personalityId: 'personality-uuid-123',
        enabled: false,
      });
      expect(mockCreateSuccessEmbed).toHaveBeenCalledWith(
        'Focus Mode Disabled',
        expect.stringContaining('disabled')
      );
    });

    it('should handle personality not found', async () => {
      mockResolvePersonalityId.mockResolvedValue({ kind: 'not-found' });

      const context = createMockContext('unknown');
      await handleFocusDisable(context);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('unknown'),
      });
      expect(stub.setFocus).not.toHaveBeenCalled();
    });

    it('shows "try again" (unavailable), not "not found", when the personality list is unavailable', async () => {
      mockResolvePersonalityId.mockResolvedValue({ kind: 'unavailable' });

      const context = createMockContext('lilith');
      await handleFocusDisable(context);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Autocomplete was unavailable'),
      });
      expect(stub.setFocus).not.toHaveBeenCalled();
    });
  });

  describe('handleFocusStatus', () => {
    it('should show status when focus mode is enabled', async () => {
      mockResolvePersonalityId.mockResolvedValue({ kind: 'found', id: 'personality-uuid-123' });
      mockGetPersonalityName.mockResolvedValue('Lilith');
      stub.getFocus.mockResolvedValue(
        makeOk({
          personalityId: 'personality-uuid-123',
          focusModeEnabled: true,
        })
      );

      const context = createMockContext();
      await handleFocusStatus(context);

      expect(stub.getFocus).toHaveBeenCalledWith({ personalityId: 'personality-uuid-123' });
      expect(mockCreateInfoEmbed).toHaveBeenCalledWith(
        'Focus Mode Status',
        expect.stringContaining('enabled')
      );
    });

    it('should show status when focus mode is disabled', async () => {
      mockResolvePersonalityId.mockResolvedValue({ kind: 'found', id: 'personality-uuid-123' });
      mockGetPersonalityName.mockResolvedValue('Lilith');
      stub.getFocus.mockResolvedValue(
        makeOk({
          personalityId: 'personality-uuid-123',
          focusModeEnabled: false,
        })
      );

      const context = createMockContext();
      await handleFocusStatus(context);

      expect(mockCreateInfoEmbed).toHaveBeenCalledWith(
        'Focus Mode Status',
        expect.stringContaining('disabled')
      );
    });

    it('should use personality slug when name not found', async () => {
      mockResolvePersonalityId.mockResolvedValue({ kind: 'found', id: 'personality-uuid-123' });
      mockGetPersonalityName.mockResolvedValue(null);
      stub.getFocus.mockResolvedValue(
        makeOk({
          personalityId: 'personality-uuid-123',
          focusModeEnabled: false,
        })
      );

      const context = createMockContext('lilith');
      await handleFocusStatus(context);

      expect(mockCreateInfoEmbed).toHaveBeenCalledWith(
        'Focus Mode Status',
        expect.stringContaining('lilith')
      );
    });

    it('should handle personality not found', async () => {
      mockResolvePersonalityId.mockResolvedValue({ kind: 'not-found' });

      const context = createMockContext('unknown');
      await handleFocusStatus(context);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('unknown'),
      });
      expect(stub.getFocus).not.toHaveBeenCalled();
    });

    it('shows "try again" (unavailable), not "not found", when the personality list is unavailable', async () => {
      mockResolvePersonalityId.mockResolvedValue({ kind: 'unavailable' });

      const context = createMockContext('lilith');
      await handleFocusStatus(context);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Autocomplete was unavailable'),
      });
      expect(stub.getFocus).not.toHaveBeenCalled();
    });

    it('should handle API error', async () => {
      mockResolvePersonalityId.mockResolvedValue({ kind: 'found', id: 'personality-uuid-123' });
      stub.getFocus.mockResolvedValue(makeErr(500, 'Server error'));

      const context = createMockContext();
      await handleFocusStatus(context);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Server error'),
      });
    });

    it('should handle exceptions', async () => {
      mockResolvePersonalityId.mockRejectedValue(new Error('Network error'));

      const context = createMockContext();
      await handleFocusStatus(context);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Failed to load the focus mode status'),
      });
    });
  });
});
