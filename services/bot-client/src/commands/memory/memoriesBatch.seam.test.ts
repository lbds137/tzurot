/**
 * Seam test for the memories batch confirm flow — runs the real chain from
 * the top-level router (`handleButton` in `interactionHandlers.ts`) through
 * the Redis-backed session lookup (`findMemoryListSessionByMessage`), the
 * confirm handler (`handleMemoryBatchConfirm`), the pre-loop label resolution
 * (`fetchPageForSession` + `fetchMemory`), the sequential deletes
 * (`deleteMemory`), and the post-loop refreshed view
 * (`buildRefreshedBrowseView`), mocking only the external boundaries
 * (`clientsFor`, in-memory Redis via `initSessionManager`, and logger).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ButtonInteraction } from 'discord.js';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';
import type { MemoryItem, MemoryListResponse } from '@tzurot/common-types/schemas/api/memory';

import { handleButton } from './interactionHandlers.js';
import { saveMemoryListSession, type MemoryListSession } from './browseSession.js';
import { buildMemoryActionId } from './detail.js';
import { encodeBatchFooterIds } from '../../utils/browse/multiSelectBatch.js';
import {
  initSessionManager,
  shutdownSessionManager,
} from '../../utils/dashboard/SessionManager.js';
import { createMockRedis } from '../../test/mockRedis.js';
import { makeOk, makeErr, asUserClient } from '../../test/gatewayClientStubs.js';

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
vi.mock('../../utils/gatewayClients.js', () => ({ clientsFor: clientsForMock }));

interface MemoryClientStub {
  list: ReturnType<typeof vi.fn>;
  getMemory: ReturnType<typeof vi.fn>;
  deleteMemory: ReturnType<typeof vi.fn>;
  setMemoryLock: ReturnType<typeof vi.fn>;
}

function createStub(): MemoryClientStub {
  return {
    list: vi.fn(),
    getMemory: vi.fn(),
    deleteMemory: vi.fn(),
    setMemoryLock: vi.fn(),
  };
}

const MESSAGE_ID = 'msg-batch-seam-1';
const USER_ID = 'user-1';
const PERSONALITY_ID = 'personality-456';

function createMockMemory(id: string, overrides: Partial<MemoryItem> = {}): MemoryItem {
  return {
    id,
    personalityId: PERSONALITY_ID,
    personalityName: 'Test Personality',
    content: `Content of ${id}`,
    isLocked: false,
    createdAt: '2026-06-15T12:00:00.000Z',
    updatedAt: '2026-06-15T12:00:00.000Z',
    ...overrides,
  } satisfies MemoryItem;
}

function listEnvelope(memories: MemoryItem[], total = memories.length) {
  return makeOk({
    memories,
    total,
    limit: 10,
    offset: 0,
    hasMore: false,
  } satisfies MemoryListResponse);
}

function createConfirmInteraction(selectedIds: readonly string[]): ButtonInteraction {
  const interaction = {
    user: { id: USER_ID },
    customId: buildMemoryActionId('batch-confirm', 'delete'),
    message: {
      id: MESSAGE_ID,
      embeds: [{ footer: { text: encodeBatchFooterIds(selectedIds) } }],
      components: [],
    },
    deferred: false,
    replied: false,
    deferUpdate: vi.fn(async () => {
      interaction.deferred = true;
    }),
    editReply: vi.fn(async () => {
      interaction.replied = true;
    }),
    followUp: vi.fn(async () => {
      interaction.replied = true;
    }),
  };
  return interaction as unknown as ButtonInteraction;
}

interface EmbedData {
  title?: string;
  description?: string;
  color?: number;
  footer?: { text: string };
}

interface EditReplyPayload {
  embeds?: unknown[];
  components?: unknown[];
}

function finalEditReplyPayload(interaction: ButtonInteraction): EditReplyPayload {
  const calls = vi.mocked(interaction.editReply).mock.calls;
  return (calls[calls.length - 1]?.[0] ?? {}) as EditReplyPayload;
}

function toEmbedData(embed: unknown): EmbedData {
  if (typeof embed === 'object' && embed !== null && 'data' in embed) {
    return (embed as { data: EmbedData }).data;
  }
  return embed as EmbedData;
}

function finalEditReplyEmbeds(interaction: ButtonInteraction): EmbedData[] {
  return (finalEditReplyPayload(interaction).embeds ?? []).map(toEmbedData);
}

describe('memoriesBatch confirm seam (router → session → confirm → refreshed view)', () => {
  let stub: MemoryClientStub;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { redis } = createMockRedis();
    initSessionManager(redis);
    stub = createStub();
    clientsForMock.mockReturnValue({ userClient: asUserClient(stub) });

    await saveMemoryListSession({
      userId: USER_ID,
      messageId: MESSAGE_ID,
      channelId: 'channel-1',
      data: {
        kind: 'browse',
        personalityId: PERSONALITY_ID,
        currentPage: 0,
      } satisfies MemoryListSession,
    });
  });

  afterEach(() => {
    shutdownSessionManager();
  });

  it('runs the real chain for an on-page id and an off-page id: deletes both and stacks the result on the refreshed browse view', async () => {
    const onPageMemory = createMockMemory('mem-on-page');
    const survivorMemory = createMockMemory('mem-survivor');
    const offPageMemory = createMockMemory('mem-off-page');

    let listCallCount = 0;
    stub.list.mockImplementation(() => {
      listCallCount += 1;
      return Promise.resolve(
        listCallCount === 1
          ? listEnvelope([onPageMemory, survivorMemory])
          : listEnvelope([survivorMemory])
      );
    });
    stub.getMemory.mockResolvedValue(makeOk({ memory: offPageMemory }));
    stub.deleteMemory.mockResolvedValue(makeOk({ success: true as const }));

    const interaction = createConfirmInteraction(['mem-on-page', 'mem-off-page']);

    await handleButton(interaction);

    expect(interaction.deferUpdate).toHaveBeenCalledTimes(1);
    expect(stub.list).toHaveBeenCalledTimes(2);
    expect(stub.list).toHaveBeenNthCalledWith(1, {
      limit: '10',
      offset: '0',
      sort: 'createdAt',
      order: 'desc',
      personalityId: PERSONALITY_ID,
    });
    expect(stub.list).toHaveBeenNthCalledWith(2, {
      limit: '10',
      offset: '0',
      sort: 'createdAt',
      order: 'desc',
      personalityId: PERSONALITY_ID,
    });
    expect(stub.getMemory).toHaveBeenCalledTimes(1);
    expect(stub.getMemory).toHaveBeenCalledWith('mem-off-page');
    expect(stub.deleteMemory).toHaveBeenCalledTimes(2);
    expect(stub.deleteMemory).toHaveBeenCalledWith('mem-on-page');
    expect(stub.deleteMemory).toHaveBeenCalledWith('mem-off-page');

    const embeds = finalEditReplyEmbeds(interaction);
    expect(embeds).toHaveLength(2);
    const [resultEmbed, browseEmbed] = embeds;
    expect(resultEmbed.title).toContain('Delete Results');
    expect(resultEmbed.color).toBe(DISCORD_COLORS.SUCCESS);
    expect(resultEmbed.description).toContain('✅ Content of mem-on-page');
    expect(resultEmbed.description).toContain('✅ Content of mem-off-page');

    expect(browseEmbed.title).toContain('Memories');
    expect(browseEmbed.description).toContain('Content of mem-survivor');
    expect(browseEmbed.description).not.toContain('Content of mem-on-page');
  });

  it('skips the gateway delete when an off-page id 404s on its per-id read and reports it already gone', async () => {
    const onPageMemory = createMockMemory('mem-on-page');
    const survivorMemory = createMockMemory('mem-survivor');

    stub.list
      .mockResolvedValueOnce(listEnvelope([onPageMemory, survivorMemory]))
      .mockResolvedValueOnce(listEnvelope([survivorMemory]));
    stub.getMemory.mockResolvedValue(makeErr(404, 'Not found'));
    stub.deleteMemory.mockResolvedValue(makeOk({ success: true as const }));

    const interaction = createConfirmInteraction(['mem-on-page', 'mem-gone']);

    await handleButton(interaction);

    expect(stub.getMemory).toHaveBeenCalledTimes(1);
    expect(stub.getMemory).toHaveBeenCalledWith('mem-gone');
    expect(stub.deleteMemory).toHaveBeenCalledTimes(1);
    expect(stub.deleteMemory).toHaveBeenCalledWith('mem-on-page');
    expect(stub.deleteMemory).not.toHaveBeenCalledWith('mem-gone');

    const embeds = finalEditReplyEmbeds(interaction);
    expect(embeds).toHaveLength(2);
    const [resultEmbed] = embeds;
    expect(resultEmbed.description).toContain('✅ Content of mem-on-page');
    expect(resultEmbed.description).toContain('◻️ Memory ID: mem-gone… — already gone');
  });

  it('locks the unlocked on-page id and skips an off-page id whose per-id read resolves isLocked: true', async () => {
    const onPageMemory = createMockMemory('mem-on-page');
    const survivorMemory = createMockMemory('mem-survivor');
    const offPageLockedMemory = createMockMemory('mem-off-page', { isLocked: true });
    const lockedOnPageMemory = createMockMemory('mem-on-page', { isLocked: true });

    stub.list
      .mockResolvedValueOnce(listEnvelope([onPageMemory, survivorMemory]))
      .mockResolvedValueOnce(listEnvelope([lockedOnPageMemory, survivorMemory]));
    stub.getMemory.mockResolvedValue(makeOk({ memory: offPageLockedMemory }));
    stub.setMemoryLock.mockResolvedValue(makeOk({ memory: lockedOnPageMemory }));

    const interaction = createConfirmInteraction(['mem-on-page', 'mem-off-page']);
    interaction.customId = buildMemoryActionId('batch-confirm', 'lock');

    await handleButton(interaction);

    expect(stub.getMemory).toHaveBeenCalledTimes(1);
    expect(stub.getMemory).toHaveBeenCalledWith('mem-off-page');
    expect(stub.setMemoryLock).toHaveBeenCalledTimes(1);
    expect(stub.setMemoryLock).toHaveBeenCalledWith('mem-on-page', { locked: true });
    expect(stub.setMemoryLock).not.toHaveBeenCalledWith('mem-off-page', expect.anything());
    expect(stub.deleteMemory).not.toHaveBeenCalled();

    const embeds = finalEditReplyEmbeds(interaction);
    expect(embeds).toHaveLength(2);
    const [resultEmbed] = embeds;
    expect(resultEmbed.title).toContain('Lock Results');
    expect(resultEmbed.color).toBe(DISCORD_COLORS.SUCCESS);
    expect(resultEmbed.description).toContain('✅ Content of mem-on-page');
    expect(resultEmbed.description).toContain('🔐 🔐 Content of mem-off-page — already locked');
  });
});
