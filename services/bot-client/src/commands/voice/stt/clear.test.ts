/**
 * Tests for /voice stt clear handler.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCallGatewayApi } = vi.hoisted(() => ({
  mockCallGatewayApi: vi.fn(),
}));

vi.mock('../../../utils/userGatewayClient.js', () => ({
  callGatewayApi: mockCallGatewayApi,
  toGatewayUser: vi.fn(user => ({ id: user.id })),
}));

vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
    voiceSttClearOptions: vi.fn(() => ({
      personality: () => 'personality-uuid-1',
    })),
  };
});

vi.mock('../../../utils/apiCheck.js', () => ({
  AUTOCOMPLETE_UNAVAILABLE_MESSAGE: '⚠️ Autocomplete unavailable',
  isAutocompleteErrorSentinel: vi.fn(() => false),
}));

const { handleSttClear } = await import('./clear.js');

function makeContext() {
  return {
    user: { id: 'discord-user-1' },
    interaction: {} as never,
    editReply: vi.fn(),
  };
}

describe('handleSttClear', () => {
  beforeEach(() => vi.clearAllMocks());

  it('DELETEs /user/stt-override/:id with encoded path', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: { deleted: true, wasSet: true },
    });

    await handleSttClear(makeContext() as never);

    expect(mockCallGatewayApi).toHaveBeenCalledWith(
      '/user/stt-override/personality-uuid-1',
      expect.objectContaining({ method: 'DELETE' })
    );
  });

  it('shows info embed when no override existed', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: { deleted: true, wasSet: false },
    });
    const context = makeContext();

    await handleSttClear(context as never);

    expect(context.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: expect.any(Array) })
    );
  });

  it('reports gateway error', async () => {
    mockCallGatewayApi.mockResolvedValue({ ok: false, status: 404, error: 'not found' });
    const context = makeContext();

    await handleSttClear(context as never);

    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('not found'),
    });
  });
});
