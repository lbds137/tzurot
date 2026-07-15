/**
 * Tests for /settings data export
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleDataExport } from './export.js';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import { makeOk, makeErr, asUserClient } from '../../../test/gatewayClientStubs.js';

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

const clientsForMock = vi.hoisted(() => vi.fn());
vi.mock('../../../utils/gatewayClients.js', () => ({
  clientsFor: clientsForMock,
}));

describe('handleDataExport', () => {
  const mockEditReply = vi.fn();
  let stub: {
    startAccountExport: ReturnType<typeof vi.fn>;
    getAccountExportStatus: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockEditReply.mockResolvedValue(undefined);
    stub = {
      startAccountExport: vi.fn(),
      getAccountExportStatus: vi.fn(),
    };
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
      commandName: 'settings',
      getOption: vi.fn(),
      getRequiredOption: vi.fn(),
      getSubcommand: vi.fn().mockReturnValue('export'),
      getSubcommandGroup: vi.fn().mockReturnValue('data'),
      interaction: {
        user: { id: '123456789', username: 'testuser' },
        options: {},
      },
    } as unknown as DeferredCommandContext;
  }

  it('starts the export and shows the download link with expiry', async () => {
    stub.startAccountExport.mockResolvedValue(
      makeOk({
        success: true,
        exportJobId: 'job-1',
        status: 'pending',
        downloadUrl: 'https://gateway.example/exports/job-1',
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
      })
    );

    await handleDataExport(createMockContext());

    expect(stub.startAccountExport).toHaveBeenCalledWith({});
    const embed = mockEditReply.mock.calls[0][0].embeds[0];
    expect(embed.data.title).toContain('Export Started');
    expect(embed.data.description).toContain('https://gateway.example/exports/job-1');
    expect(embed.data.description).toContain('never included');
  });

  it('shows the current job status on 409 (re-run doubles as status check)', async () => {
    stub.startAccountExport.mockResolvedValue(makeErr(409, 'already in progress'));
    stub.getAccountExportStatus.mockResolvedValue(
      makeOk({
        job: {
          id: 'job-1',
          status: 'completed',
          fileName: 'f.json',
          fileSizeBytes: 10,
          createdAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
          errorMessage: null,
          downloadUrl: 'https://gateway.example/exports/job-1',
        },
      })
    );

    await handleDataExport(createMockContext());

    expect(stub.getAccountExportStatus).toHaveBeenCalled();
    const embed = mockEditReply.mock.calls[0][0].embeds[0];
    expect(embed.data.title).toContain('Status');
    expect(embed.data.description).toContain('https://gateway.example/exports/job-1');
  });

  it('reports non-409 failures plainly', async () => {
    stub.startAccountExport.mockResolvedValue(makeErr(500, 'boom'));

    await handleDataExport(createMockContext());

    expect(mockEditReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('failed to start') })
    );
  });
});
