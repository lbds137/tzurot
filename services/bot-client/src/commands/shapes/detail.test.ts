/**
 * Tests for Shapes Detail View
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildShapeDetailEmbed } from './detail.js';
import type { GatewayUser } from '../../utils/userGatewayClient.js';

function mkUser(discordId = 'user-123'): GatewayUser {
  return { discordId, username: 'test-user', displayName: 'Test User' };
}

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
  toGatewayUser: (user: { id?: string; username?: string; globalName?: string | null }) => ({
    discordId: user.id ?? 'test-user-id',
    username: user.username ?? 'testuser',
    displayName: user.globalName ?? user.username ?? 'testuser',
  }),
}));

describe('buildShapeDetailEmbed', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should show slug in title and footer', async () => {
    mockCallGatewayApi.mockResolvedValue({ ok: true, data: { jobs: [] } });

    const { embed } = await buildShapeDetailEmbed(mkUser(), 'my-shape');

    expect(embed.data.title).toContain('my-shape');
    expect(embed.data.footer?.text).toBe('slug:my-shape|sort:name');
  });

  it('should show "No imports yet" when no import jobs exist', async () => {
    mockCallGatewayApi.mockResolvedValue({ ok: true, data: { jobs: [] } });

    const { embed } = await buildShapeDetailEmbed(mkUser(), 'my-shape');

    expect(embed.data.description).toContain('No imports yet');
  });

  it('should show "No exports yet" when no export jobs exist', async () => {
    mockCallGatewayApi.mockResolvedValue({ ok: true, data: { jobs: [] } });

    const { embed } = await buildShapeDetailEmbed(mkUser(), 'my-shape');

    expect(embed.data.description).toContain('No exports yet');
  });

  it('should show import status when job exists for slug', async () => {
    mockCallGatewayApi
      .mockResolvedValueOnce({
        ok: true,
        data: {
          jobs: [
            {
              id: 'job-1',
              sourceSlug: 'my-shape',
              status: 'completed',
              importType: 'full',
              memoriesImported: 42,
              memoriesFailed: 0,
              createdAt: '2026-01-15T00:00:00Z',
              completedAt: '2026-01-15T00:01:00Z',
              errorMessage: null,
              importMetadata: null,
            },
          ],
        },
      })
      .mockResolvedValueOnce({ ok: true, data: { jobs: [] } });

    const { embed } = await buildShapeDetailEmbed(mkUser(), 'my-shape');

    expect(embed.data.description).toContain('42 memories imported');
  });

  it('should pass slug query param to gateway for server-side filtering', async () => {
    mockCallGatewayApi.mockResolvedValue({ ok: true, data: { jobs: [] } });

    await buildShapeDetailEmbed(mkUser(), 'my-shape');

    // Verify slug is passed as query parameter (server-side filtering)
    expect(mockCallGatewayApi).toHaveBeenCalledWith(
      '/user/shapes/import/jobs?slug=my-shape',
      expect.anything()
    );
    expect(mockCallGatewayApi).toHaveBeenCalledWith(
      '/user/shapes/export/jobs?slug=my-shape',
      expect.anything()
    );
  });

  it('should include action buttons in two rows', async () => {
    mockCallGatewayApi.mockResolvedValue({ ok: true, data: { jobs: [] } });

    const { components } = await buildShapeDetailEmbed(mkUser(), 'my-shape');

    expect(components).toHaveLength(2);

    // Row 1: 4 action buttons
    const row1Buttons = components[0].components as { data: { custom_id: string } }[];
    expect(row1Buttons).toHaveLength(4);
    expect(row1Buttons[0].data.custom_id).toBe('shapes::detail-import::full');
    expect(row1Buttons[1].data.custom_id).toBe('shapes::detail-import::memory_only');
    expect(row1Buttons[2].data.custom_id).toBe('shapes::detail-export::json');
    expect(row1Buttons[3].data.custom_id).toBe('shapes::detail-export::markdown');

    // Row 2: refresh + back
    const row2Buttons = components[1].components as { data: { custom_id: string } }[];
    expect(row2Buttons).toHaveLength(2);
    expect(row2Buttons[0].data.custom_id).toBe('shapes::detail-refresh');
    expect(row2Buttons[1].data.custom_id).toBe('shapes::detail-back');
  });

  it('should handle API errors gracefully', async () => {
    mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

    const { embed } = await buildShapeDetailEmbed(mkUser(), 'my-shape');

    // Should still build the embed with "no jobs" status
    expect(embed.data.title).toContain('my-shape');
    expect(embed.data.description).toContain('No imports yet');
  });
});
