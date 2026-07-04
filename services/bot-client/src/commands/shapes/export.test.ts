/**
 * Tests for Shapes Export Subcommand (Async)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleExport } from './export.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
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

describe('handleExport', () => {
  const mockEditReply = vi.fn();
  const mockGetString = vi.fn();
  let stub: { startShapesExport: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetString.mockReturnValue('test-character');
    mockEditReply.mockResolvedValue(undefined);
    stub = { startShapesExport: vi.fn() };
    clientsForMock.mockReturnValue({ userClient: asUserClient(stub) });
  });

  function createMockContext(): DeferredCommandContext {
    return {
      user: { id: '123456789', username: 'testuser' },
      editReply: mockEditReply,
      guild: null,
      member: null,
      channel: null,
      channelId: 'channel-123',
      guildId: null,
      commandName: 'shapes',
      getOption: vi.fn(),
      getRequiredOption: vi.fn(),
      getSubcommand: vi.fn().mockReturnValue('export'),
      getSubcommandGroup: vi.fn().mockReturnValue(null),
      interaction: {
        user: { id: '123456789', username: 'testuser' },
        options: { getString: mockGetString },
      },
    } as unknown as DeferredCommandContext;
  }

  it('should call async export endpoint and show confirmation', async () => {
    stub.startShapesExport.mockResolvedValue(
      makeOk({
        success: true,
        exportJobId: 'job-uuid-123',
        sourceSlug: 'test-character',
        format: 'json',
        status: 'pending',
        downloadUrl: 'https://gateway.example.com/exports/job-uuid-123',
      })
    );

    const context = createMockContext();
    await handleExport(context);

    expect(stub.startShapesExport).toHaveBeenCalledWith({
      slug: 'test-character',
      format: 'json',
    });

    const lastCall = mockEditReply.mock.calls[mockEditReply.mock.calls.length - 1][0];
    expect(lastCall.embeds[0].data.title).toContain('Export Started');
    expect(lastCall.embeds[0].data.description).toContain('/shapes status');
  });

  it('should show auth prompt when no credentials', async () => {
    stub.startShapesExport.mockResolvedValue(makeErr(403, 'No credentials'));

    const context = createMockContext();
    await handleExport(context);

    const lastCall = mockEditReply.mock.calls[mockEditReply.mock.calls.length - 1][0];
    expect(lastCall.content).toContain('No shapes.inc credentials');
  });

  it('should show in-progress message for 409 conflict', async () => {
    stub.startShapesExport.mockResolvedValue(makeErr(409, 'Already in progress'));

    const context = createMockContext();
    await handleExport(context);

    const lastCall = mockEditReply.mock.calls[mockEditReply.mock.calls.length - 1][0];
    expect(lastCall.content).toContain('already in progress');
  });

  it('should handle network errors gracefully', async () => {
    stub.startShapesExport.mockRejectedValue(new Error('Network error'));

    const context = createMockContext();
    await handleExport(context);

    const lastCall = mockEditReply.mock.calls[mockEditReply.mock.calls.length - 1][0];
    expect(lastCall.content).toContain('unexpected error');
  });

  it('rejects the autocomplete-error sentinel before calling the gateway', async () => {
    mockGetString.mockReturnValue('__autocomplete_error__');

    const context = createMockContext();
    await handleExport(context);

    expect(stub.startShapesExport).not.toHaveBeenCalled();
    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Autocomplete was unavailable'),
    });
  });
});
