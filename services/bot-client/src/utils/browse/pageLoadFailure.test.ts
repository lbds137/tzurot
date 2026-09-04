/**
 * Tests for the shared browse page-load failure follow-up.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageFlags, type MessageComponentInteraction } from 'discord.js';
import { followUpBrowsePageFailure } from './pageLoadFailure.js';
import { classifyGatewayFailure } from '../../ux/catalog/classify.js';
import { renderSpec } from '../../ux/render/render.js';

const { loggerMock } = vi.hoisted(() => ({
  loggerMock: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => loggerMock,
  };
});

function interaction(): { followUp: ReturnType<typeof vi.fn> } {
  return { followUp: vi.fn() };
}

describe('followUpBrowsePageFailure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('follows up ephemerally with the classified failure content', async () => {
    const error = new Error('boom');
    const mockInteraction = interaction();

    await followUpBrowsePageFailure(
      mockInteraction as unknown as MessageComponentInteraction,
      error
    );

    const expectedContent = renderSpec(
      classifyGatewayFailure(error, 'page', { operation: 'read' })
    );
    expect(expectedContent.length).toBeGreaterThan(0);
    expect(mockInteraction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({
        flags: MessageFlags.Ephemeral,
        content: expectedContent,
      })
    );
  });

  it('follows up ephemerally for a different error shape (a gateway result failure)', async () => {
    const gatewayFailure = { ok: false, kind: 'http', error: 'Not found', status: 404 };
    const mockInteraction = interaction();

    await followUpBrowsePageFailure(
      mockInteraction as unknown as MessageComponentInteraction,
      gatewayFailure
    );

    const expectedContent = renderSpec(
      classifyGatewayFailure(gatewayFailure, 'page', { operation: 'read' })
    );
    expect(expectedContent.length).toBeGreaterThan(0);
    expect(mockInteraction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({
        flags: MessageFlags.Ephemeral,
        content: expectedContent,
      })
    );
  });

  it('a rejected follow-up is logged, not propagated', async () => {
    const followUpError = new Error('webhook token expired');
    const mockInteraction = {
      followUp: vi.fn().mockRejectedValue(followUpError),
      customId: 'browse::page::42',
    };

    await expect(
      followUpBrowsePageFailure(
        mockInteraction as unknown as MessageComponentInteraction,
        new Error('boom')
      )
    ).resolves.toBeUndefined();

    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.objectContaining({ customId: 'browse::page::42' }),
      expect.any(String)
    );
  });
});
