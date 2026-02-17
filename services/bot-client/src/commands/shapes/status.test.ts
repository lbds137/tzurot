/**
 * Tests for Shapes Status Subcommand
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleStatus } from './status.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';

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

describe('handleStatus', () => {
  const mockEditReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createMockContext(): DeferredCommandContext {
    return {
      user: { id: '123456789' },
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
        options: { getString: vi.fn() },
      },
    } as unknown as DeferredCommandContext;
  }

  /** Set up default mock responses for all 3 parallel calls */
  function setupDefaultMocks(overrides?: { auth?: unknown; imports?: unknown; exports?: unknown }) {
    mockCallGatewayApi
      .mockResolvedValueOnce(
        overrides?.auth ?? { ok: true, data: { hasCredentials: true, service: 'shapes_inc' } }
      )
      .mockResolvedValueOnce(overrides?.imports ?? { ok: true, data: { jobs: [] } })
      .mockResolvedValueOnce(overrides?.exports ?? { ok: true, data: { jobs: [] } });
  }

  it('should fetch auth status, import jobs, and export jobs in parallel', async () => {
    setupDefaultMocks();

    const context = createMockContext();
    await handleStatus(context);

    expect(mockCallGatewayApi).toHaveBeenCalledTimes(3);
    expect(mockCallGatewayApi).toHaveBeenCalledWith(
      '/user/shapes/auth/status',
      expect.objectContaining({ userId: '123456789' })
    );
    expect(mockCallGatewayApi).toHaveBeenCalledWith(
      '/user/shapes/import/jobs',
      expect.objectContaining({ userId: '123456789' })
    );
    expect(mockCallGatewayApi).toHaveBeenCalledWith(
      '/user/shapes/export/jobs',
      expect.objectContaining({ userId: '123456789' })
    );
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
      auth: { ok: true, data: { hasCredentials: false, service: 'shapes_inc' } },
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
      imports: {
        ok: true,
        data: {
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
        },
      },
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
      exports: {
        ok: true,
        data: {
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
        },
      },
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

  it('should handle network errors gracefully', async () => {
    mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

    const context = createMockContext();
    await handleStatus(context);

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('unexpected error'),
    });
  });
});
