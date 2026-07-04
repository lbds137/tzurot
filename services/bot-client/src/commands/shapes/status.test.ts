/**
 * Tests for Shapes Status Subcommand
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleStatus } from './status.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import type { GatewayResult } from '@tzurot/clients';
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

describe('handleStatus', () => {
  const mockEditReply = vi.fn();
  let stub: {
    getShapesAuthStatus: ReturnType<typeof vi.fn>;
    listShapesImportJobs: ReturnType<typeof vi.fn>;
    listShapesExportJobs: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    stub = {
      getShapesAuthStatus: vi.fn(),
      listShapesImportJobs: vi.fn(),
      listShapesExportJobs: vi.fn(),
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
      commandName: 'shapes',
      getOption: vi.fn(),
      getRequiredOption: vi.fn(),
      getSubcommand: vi.fn().mockReturnValue('status'),
      getSubcommandGroup: vi.fn().mockReturnValue(null),
      interaction: {
        user: { id: '123456789', username: 'testuser' },
        options: { getString: vi.fn() },
      },
    } as unknown as DeferredCommandContext;
  }

  function setupDefaultMocks(overrides?: {
    auth?: GatewayResult<unknown>;
    imports?: GatewayResult<unknown>;
    exports?: GatewayResult<unknown>;
  }) {
    stub.getShapesAuthStatus.mockResolvedValue(
      overrides?.auth ?? makeOk({ hasCredentials: true, service: 'shapes_inc' })
    );
    stub.listShapesImportJobs.mockResolvedValue(overrides?.imports ?? makeOk({ jobs: [] }));
    stub.listShapesExportJobs.mockResolvedValue(overrides?.exports ?? makeOk({ jobs: [] }));
  }

  it('should fetch auth status, import jobs, and export jobs in parallel', async () => {
    setupDefaultMocks();

    const context = createMockContext();
    await handleStatus(context);

    expect(stub.getShapesAuthStatus).toHaveBeenCalledTimes(1);
    expect(stub.listShapesImportJobs).toHaveBeenCalledTimes(1);
    expect(stub.listShapesExportJobs).toHaveBeenCalledTimes(1);
  });

  it('should show authenticated status when credentials exist', async () => {
    setupDefaultMocks();

    const context = createMockContext();
    await handleStatus(context);

    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          data: expect.objectContaining({
            title: expect.stringContaining('Status'),
          }),
        }),
      ],
    });
  });

  it('should show unauthenticated status when no credentials', async () => {
    setupDefaultMocks({
      auth: makeOk({ hasCredentials: false, service: 'shapes_inc' }),
    });

    const context = createMockContext();
    await handleStatus(context);

    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          data: expect.objectContaining({
            fields: expect.arrayContaining([
              expect.objectContaining({
                name: 'Credentials',
                value: expect.stringContaining('Not authenticated'),
              }),
            ]),
          }),
        }),
      ],
    });
  });

  it('should display import history when jobs exist', async () => {
    setupDefaultMocks({
      imports: makeOk({
        jobs: [
          {
            id: 'job-1',
            sourceSlug: 'test-char',
            status: 'completed',
            importType: 'full',
            memoriesImported: 42,
            memoriesFailed: 0,
            createdAt: '2026-01-15T00:00:00.000Z',
            completedAt: '2026-01-15T00:01:00.000Z',
            errorMessage: null,
          },
        ],
      }),
    });

    const context = createMockContext();
    await handleStatus(context);

    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          data: expect.objectContaining({
            fields: expect.arrayContaining([
              expect.objectContaining({
                name: expect.stringContaining('Import History'),
                value: expect.stringContaining('test-char'),
              }),
            ]),
          }),
        }),
      ],
    });
  });

  it('should display export history with download links', async () => {
    setupDefaultMocks({
      exports: makeOk({
        jobs: [
          {
            id: 'export-1',
            sourceSlug: 'test-char',
            status: 'completed',
            format: 'json',
            fileName: 'test-char-export.json',
            fileSizeBytes: 1048576,
            createdAt: '2026-02-16T00:00:00.000Z',
            completedAt: '2026-02-16T00:05:00.000Z',
            expiresAt: new Date(Date.now() + 86400000).toISOString(),
            errorMessage: null,
            downloadUrl: 'https://gateway.example.com/exports/export-1',
          },
        ],
      }),
    });

    const context = createMockContext();
    await handleStatus(context);

    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          data: expect.objectContaining({
            fields: expect.arrayContaining([
              expect.objectContaining({
                name: expect.stringContaining('Export History'),
                value: expect.stringContaining('Download'),
              }),
            ]),
          }),
        }),
      ],
    });
  });

  it('should show no-imports message when job list is empty', async () => {
    setupDefaultMocks();

    const context = createMockContext();
    await handleStatus(context);

    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          data: expect.objectContaining({
            fields: expect.arrayContaining([
              expect.objectContaining({
                name: 'Import History',
                value: expect.stringContaining('No imports yet'),
              }),
            ]),
          }),
        }),
      ],
    });
  });

  it('should show no-exports message when export job list is empty', async () => {
    setupDefaultMocks();

    const context = createMockContext();
    await handleStatus(context);

    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          data: expect.objectContaining({
            fields: expect.arrayContaining([
              expect.objectContaining({
                name: 'Export History',
                value: expect.stringContaining('No exports yet'),
              }),
            ]),
          }),
        }),
      ],
    });
  });

  it('should show a load-failed message (not "No imports") when import history fetch fails', async () => {
    setupDefaultMocks({ imports: makeErr(503, 'service unavailable') });

    const context = createMockContext();
    await handleStatus(context);

    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          data: expect.objectContaining({
            fields: expect.arrayContaining([
              expect.objectContaining({
                name: 'Import History',
                value: expect.stringContaining('Could not load import history'),
              }),
            ]),
          }),
        }),
      ],
    });
  });

  it('should show a load-failed message (not "No exports") when export history fetch fails', async () => {
    setupDefaultMocks({ exports: makeErr(503, 'service unavailable') });

    const context = createMockContext();
    await handleStatus(context);

    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          data: expect.objectContaining({
            fields: expect.arrayContaining([
              expect.objectContaining({
                name: 'Export History',
                value: expect.stringContaining('Could not load export history'),
              }),
            ]),
          }),
        }),
      ],
    });
  });

  it('should handle network errors gracefully', async () => {
    stub.getShapesAuthStatus.mockRejectedValue(new Error('Network error'));
    stub.listShapesImportJobs.mockRejectedValue(new Error('Network error'));
    stub.listShapesExportJobs.mockRejectedValue(new Error('Network error'));

    const context = createMockContext();
    await handleStatus(context);

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('unexpected error'),
    });
  });
});
