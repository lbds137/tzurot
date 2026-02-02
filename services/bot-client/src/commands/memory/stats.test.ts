/**
 * Tests for Memory Stats Subcommand
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleStats } from './stats.js';

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
const mockCreateInfoEmbed = vi.fn(() => ({
  addFields: vi.fn().mockReturnThis(),
}));
vi.mock('../../utils/commandHelpers.js', () => ({
  createInfoEmbed: (...args: unknown[]) =>
    mockCreateInfoEmbed(...(args as Parameters<typeof mockCreateInfoEmbed>)),
}));

// Mock autocomplete
const mockResolvePersonalityId = vi.fn();
vi.mock('./autocomplete.js', () => ({
  resolvePersonalityId: (...args: unknown[]) => mockResolvePersonalityId(...args),
}));

describe('handleStats', () => {
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
    } as unknown as Parameters<typeof handleStats>[0];
  }

  it('should get stats successfully', async () => {
    mockResolvePersonalityId.mockResolvedValue('personality-uuid-123');
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        personalityId: 'personality-uuid-123',
        personalityName: 'Lilith',
        personaId: 'persona-123',
        totalCount: 42,
        lockedCount: 5,
        oldestMemory: '2025-01-01T00:00:00.000Z',
        newestMemory: '2025-06-15T12:00:00.000Z',
        focusModeEnabled: false,
      },
    });

    const context = createMockContext();
    await handleStats(context);

    expect(mockResolvePersonalityId).toHaveBeenCalledWith('123456789', 'lilith');
    expect(mockCallGatewayApi).toHaveBeenCalledWith(
      '/user/memory/stats?personalityId=personality-uuid-123',
      { userId: '123456789', method: 'GET' }
    );
    expect(mockCreateInfoEmbed).toHaveBeenCalledWith(
      'Memory Statistics',
      expect.stringContaining('Lilith')
    );
    expect(mockEditReply).toHaveBeenCalledWith({ embeds: [expect.any(Object)] });
  });

  it('should show focus mode active indicator', async () => {
    const mockEmbed = { addFields: vi.fn().mockReturnThis() };
    mockCreateInfoEmbed.mockReturnValue(mockEmbed);
    mockResolvePersonalityId.mockResolvedValue('personality-uuid-123');

    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        personalityId: 'personality-uuid-123',
        personalityName: 'Lilith',
        personaId: 'persona-123',
        totalCount: 10,
        lockedCount: 2,
        oldestMemory: '2025-01-01T00:00:00.000Z',
        newestMemory: '2025-06-15T12:00:00.000Z',
        focusModeEnabled: true,
      },
    });

    const context = createMockContext();
    await handleStats(context);

    expect(mockCreateInfoEmbed).toHaveBeenCalledWith(
      'Memory Statistics',
      expect.stringContaining('Focus Mode Active')
    );
  });

  it('should show no profile message when personaId is null', async () => {
    const mockEmbed = { addFields: vi.fn().mockReturnThis() };
    mockCreateInfoEmbed.mockReturnValue(mockEmbed);
    mockResolvePersonalityId.mockResolvedValue('personality-uuid-123');

    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        personalityId: 'personality-uuid-123',
        personalityName: 'Lilith',
        personaId: null,
        totalCount: 0,
        lockedCount: 0,
        oldestMemory: null,
        newestMemory: null,
        focusModeEnabled: false,
      },
    });

    const context = createMockContext();
    await handleStats(context);

    expect(mockCreateInfoEmbed).toHaveBeenCalledWith(
      'Memory Statistics',
      expect.stringContaining('No profile configured')
    );

    // Should NOT include Date Range field when totalCount is 0
    const addFieldsCalls = mockEmbed.addFields.mock.calls as Array<
      Array<{ name: string }[] | { name: string }>
    >;
    const allFieldNames = addFieldsCalls.flatMap(call =>
      call.flatMap(fields => (Array.isArray(fields) ? fields.map(f => f.name) : [fields.name]))
    );
    expect(allFieldNames).not.toContain('Date Range');
  });

  it('should handle personality not found from resolver', async () => {
    mockResolvePersonalityId.mockResolvedValue(null);

    const context = createMockContext('unknown');
    await handleStats(context);

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('unknown'),
    });
    expect(mockCallGatewayApi).not.toHaveBeenCalled();
  });

  it('should handle personality not found (404)', async () => {
    mockResolvePersonalityId.mockResolvedValue('personality-uuid-123');
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      status: 404,
      error: 'Not found',
    });

    const context = createMockContext('unknown');
    await handleStats(context);

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('not found'),
    });
  });

  it('should handle generic API error', async () => {
    mockResolvePersonalityId.mockResolvedValue('personality-uuid-123');
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      status: 500,
      error: 'Server error',
    });

    const context = createMockContext();
    await handleStats(context);

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Failed to get stats'),
    });
  });

  it('should handle exceptions', async () => {
    mockResolvePersonalityId.mockRejectedValue(new Error('Network error'));

    const context = createMockContext();
    await handleStats(context);

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('unexpected error'),
    });
  });
});
