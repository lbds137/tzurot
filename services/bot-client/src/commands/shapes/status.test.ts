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

  it('should fetch auth status and import jobs in parallel', async () => {
    mockCallGatewayApi
      .mockResolvedValueOnce({ ok: true, data: { hasCredentials: true, service: 'shapes_inc' } })
      .mockResolvedValueOnce({ ok: true, data: { jobs: [] } });

    const context = createMockContext();
    await handleStatus(context);

    expect(mockCallGatewayApi).toHaveBeenCalledTimes(2);
    expect(mockCallGatewayApi).toHaveBeenCalledWith(
      '/user/shapes/auth/status',
      expect.objectContaining({ userId: '123456789' })
    );
    expect(mockCallGatewayApi).toHaveBeenCalledWith(
      '/user/shapes/import/jobs',
      expect.objectContaining({ userId: '123456789' })
    );
  });

  it('should show authenticated status when credentials exist', async () => {
    mockCallGatewayApi
      .mockResolvedValueOnce({ ok: true, data: { hasCredentials: true, service: 'shapes_inc' } })
      .mockResolvedValueOnce({ ok: true, data: { jobs: [] } });

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
    mockCallGatewayApi
      .mockResolvedValueOnce({ ok: true, data: { hasCredentials: false, service: 'shapes_inc' } })
      .mockResolvedValueOnce({ ok: true, data: { jobs: [] } });

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
    mockCallGatewayApi
      .mockResolvedValueOnce({ ok: true, data: { hasCredentials: true, service: 'shapes_inc' } })
      .mockResolvedValueOnce({
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

  it('should show no-imports message when job list is empty', async () => {
    mockCallGatewayApi
      .mockResolvedValueOnce({ ok: true, data: { hasCredentials: true, service: 'shapes_inc' } })
      .mockResolvedValueOnce({ ok: true, data: { jobs: [] } });

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
