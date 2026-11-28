/**
 * Unit tests for the edit-reply handlers: access scoping, the update payload,
 * validation, and the non-fatal memory rewrite. The access gate's real
 * exclusion of another user's row is pinned in `historyEdit.component.test.ts`.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../types.js';
import type { RouteDeps } from '../routeDeps.js';

const { mockIsBotOwner, mockPlan, mockApply } = vi.hoisted(() => ({
  mockIsBotOwner: vi.fn(() => false),
  mockPlan: vi.fn(),
  mockApply: vi.fn(),
}));

vi.mock('@tzurot/common-types/utils/ownerMiddleware', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/ownerMiddleware')>(
    '@tzurot/common-types/utils/ownerMiddleware'
  );
  return { ...actual, isBotOwner: mockIsBotOwner };
});

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

vi.mock('./historyEditMemory.js', () => ({
  planExchangeMemorySync: mockPlan,
  applyExchangeMemorySync: mockApply,
}));

import { handleEditAssistantMessage, handleGetEditableMessage } from './historyEdit.js';

const CALLER = '900000000000000071';
const MESSAGE_ID = '222222222222222222';

const ROW = {
  id: 'row-1',
  content: 'Stored reply',
  discordMessageId: [MESSAGE_ID, '222222222222222223'],
  personaId: 'persona-1',
  personalityId: 'personality-1',
  channelId: '123456789012345678',
  createdAt: new Date('2026-06-04T12:00:00.000Z'),
};

describe('history edit handlers', () => {
  const findFirst = vi.fn();
  const update = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsBotOwner.mockReturnValue(false);
    mockPlan.mockResolvedValue({ kind: 'sync', memoryId: 'mem-1', pendingId: 'pend-1' });
    mockApply.mockResolvedValue(undefined);
    update.mockResolvedValue({});
  });

  function deps(): RouteDeps {
    return { prisma: { conversationHistory: { findFirst, update } } } as unknown as RouteDeps;
  }

  function reqRes(userId: string | undefined, body: unknown = {}) {
    const req = {
      userId,
      params: { messageId: MESSAGE_ID },
      body,
      query: {},
    } as unknown as AuthenticatedRequest;
    const json = vi.fn().mockReturnThis();
    const status = vi.fn().mockReturnThis();
    return { req, res: { status, json } as unknown as Response, json, status };
  }

  const validBody = { content: 'New reply', discordMessageIds: [MESSAGE_ID] };

  describe('GET', () => {
    it('returns content, chunk ids and personality for the owner', async () => {
      findFirst.mockResolvedValue(ROW);
      const { req, res, json } = reqRes(CALLER);

      await handleGetEditableMessage(deps())(req, res, () => undefined);

      expect(json).toHaveBeenCalledWith({
        content: 'Stored reply',
        discordMessageIds: ROW.discordMessageId,
        personalityId: 'personality-1',
        memorySync: { kind: 'sync' },
      });
      expect(mockPlan).toHaveBeenCalledWith(expect.anything(), ROW);
    });

    it('reports a blocked memory state with its reason', async () => {
      findFirst.mockResolvedValue(ROW);
      mockPlan.mockResolvedValue({ kind: 'blocked', reason: 'locked' });
      const { req, res, json } = reqRes(CALLER);

      await handleGetEditableMessage(deps())(req, res, () => undefined);

      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({ memorySync: { kind: 'blocked', reason: 'locked' } })
      );
    });

    it('404s a non-owner and queries with the owner-scope WHERE', async () => {
      findFirst.mockResolvedValue(null);
      const { req, res, status } = reqRes(CALLER);

      await handleGetEditableMessage(deps())(req, res, () => undefined);

      expect(status).toHaveBeenCalledWith(404);
      expect(findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            persona: { owner: { discordId: CALLER } },
            discordMessageId: { has: MESSAGE_ID },
            deletedAt: null,
          }),
        })
      );
    });

    it('omits the ownership predicate for the bot owner', async () => {
      mockIsBotOwner.mockReturnValue(true);
      findFirst.mockResolvedValue(ROW);
      const { req, res } = reqRes(CALLER);

      await handleGetEditableMessage(deps())(req, res, () => undefined);

      const where = findFirst.mock.calls[0][0].where as Record<string, unknown>;
      expect(where.persona).toBeUndefined();
    });

    it('500s and queries nothing without a caller identity', async () => {
      const { req, res, status } = reqRes(undefined);

      await handleGetEditableMessage(deps())(req, res, () => undefined);

      expect(status).toHaveBeenCalledWith(500);
      expect(findFirst).not.toHaveBeenCalled();
    });
  });

  describe('PATCH', () => {
    it('updates content, tokenCount, editedAt and the chunk ids', async () => {
      findFirst.mockResolvedValue(ROW);
      const { req, res, json } = reqRes(CALLER, validBody);

      await handleEditAssistantMessage(deps())(req, res, () => undefined);

      expect(update).toHaveBeenCalledWith({
        where: { id: 'row-1' },
        data: {
          content: 'New reply',
          tokenCount: expect.any(Number),
          editedAt: expect.any(Date),
          discordMessageId: [MESSAGE_ID],
        },
      });
      expect(mockPlan).toHaveBeenCalledWith(expect.anything(), ROW, 'New reply');
      expect(mockApply).toHaveBeenCalledWith(
        expect.anything(),
        { kind: 'sync', memoryId: 'mem-1', pendingId: 'pend-1' },
        'New reply'
      );
      expect(json).toHaveBeenCalledWith({ edited: true, memory: { kind: 'synced' } });
    });

    it('404s a non-owner without updating, scoped by the owner WHERE', async () => {
      findFirst.mockResolvedValue(null);
      const { req, res, status } = reqRes(CALLER, validBody);

      await handleEditAssistantMessage(deps())(req, res, () => undefined);

      expect(status).toHaveBeenCalledWith(404);
      expect(update).not.toHaveBeenCalled();
      expect(mockApply).not.toHaveBeenCalled();
      expect(findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ persona: { owner: { discordId: CALLER } } }),
        })
      );
    });

    it('lets the bot owner bypass the ownership scope', async () => {
      mockIsBotOwner.mockReturnValue(true);
      findFirst.mockResolvedValue(ROW);
      const { req, res } = reqRes(CALLER, validBody);

      await handleEditAssistantMessage(deps())(req, res, () => undefined);

      const where = findFirst.mock.calls[0][0].where as Record<string, unknown>;
      expect(where.persona).toBeUndefined();
      expect(update).toHaveBeenCalled();
    });

    it('400s when the first chunk id differs from the stored first id, without updating', async () => {
      findFirst.mockResolvedValue(ROW);
      const { req, res, status } = reqRes(CALLER, {
        content: 'New reply',
        discordMessageIds: ['222222222222222223'],
      });

      await handleEditAssistantMessage(deps())(req, res, () => undefined);

      expect(status).toHaveBeenCalledWith(400);
      expect(update).not.toHaveBeenCalled();
      expect(mockApply).not.toHaveBeenCalled();
    });

    it('400s an invalid body before any query', async () => {
      const { req, res, status } = reqRes(CALLER, { content: '', discordMessageIds: [] });

      await handleEditAssistantMessage(deps())(req, res, () => undefined);

      expect(status).toHaveBeenCalledWith(400);
      expect(findFirst).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    });

    it('still succeeds with a none outcome when the memory sync throws', async () => {
      findFirst.mockResolvedValue(ROW);
      mockApply.mockRejectedValue(new Error('boom'));
      const { req, res, json, status } = reqRes(CALLER, validBody);

      await handleEditAssistantMessage(deps())(req, res, () => undefined);

      expect(update).toHaveBeenCalled();
      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith({ edited: true, memory: { kind: 'none' } });
    });

    it('writes the history row but skips the apply and returns blocked when re-planning blocks', async () => {
      findFirst.mockResolvedValue(ROW);
      mockPlan.mockResolvedValue({ kind: 'blocked', reason: 'locked' });
      const { req, res, json } = reqRes(CALLER, validBody);

      await handleEditAssistantMessage(deps())(req, res, () => undefined);

      expect(update).toHaveBeenCalled();
      expect(mockApply).not.toHaveBeenCalled();
      expect(json).toHaveBeenCalledWith({
        edited: true,
        memory: { kind: 'blocked', reason: 'locked' },
      });
    });

    it('returns none without applying when there is nothing to sync', async () => {
      findFirst.mockResolvedValue(ROW);
      mockPlan.mockResolvedValue({ kind: 'none' });
      const { req, res, json } = reqRes(CALLER, validBody);

      await handleEditAssistantMessage(deps())(req, res, () => undefined);

      expect(mockApply).not.toHaveBeenCalled();
      expect(json).toHaveBeenCalledWith({ edited: true, memory: { kind: 'none' } });
    });
  });
});
