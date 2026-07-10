/**
 * Tests for the Memory Facts browser (/memory facts).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ButtonInteraction } from 'discord.js';
import {
  FACT_BROWSE_PREFIX,
  factBrowseHelpers,
  isFactBrowsePagination,
  handleFacts,
  handleFactsPagination,
  refreshFactsList,
} from './factsBrowse.js';
import type { FactItem } from './factsApi.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
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

const resolveRequiredPersonalityMock = vi.hoisted(() => vi.fn());
vi.mock('./resolveHelpers.js', () => ({
  resolveRequiredPersonality: resolveRequiredPersonalityMock,
}));

const sessionManagerMock = vi.hoisted(() => ({
  set: vi.fn().mockResolvedValue(undefined),
  get: vi.fn(),
  update: vi.fn().mockResolvedValue(undefined),
  findByMessageId: vi.fn(),
}));
vi.mock('../../utils/dashboard/index.js', () => ({
  getSessionManager: () => sessionManagerMock,
}));

interface FactClientStub {
  listFacts: ReturnType<typeof vi.fn>;
}

const createMockFact = (overrides: Partial<FactItem> = {}): FactItem => ({
  id: 'fact-123',
  personalityId: 'personality-456',
  personaId: 'persona-789',
  statement: 'The user has a cat named Miso',
  entityTags: ['user'],
  salience: 0.7,
  tier: 'observed',
  isLocked: false,
  validFrom: '2026-06-15T12:00:00.000Z',
  supersededAt: null,
  supersededById: null,
  forgotten: false,
  sourceMemoryIds: [],
  createdAt: '2026-06-15T12:00:00.000Z',
  ...overrides,
});

function listResponse(facts: FactItem[], total = facts.length) {
  return makeOk({ facts, total, limit: 10, offset: 0, hasMore: false });
}

describe('fact browse custom IDs', () => {
  it('matches its own pagination ids and nothing else', () => {
    expect(isFactBrowsePagination(factBrowseHelpers.build(1, 'all', 'date', null))).toBe(true);
    expect(isFactBrowsePagination('memory-browse::browse::1::all')).toBe(false);
    expect(isFactBrowsePagination('memory-fact::select')).toBe(false);
  });

  it('exports the session entity type as the component prefix', () => {
    expect(FACT_BROWSE_PREFIX).toBe('memory-fact-browse');
  });
});

describe('handleFacts', () => {
  let stub: FactClientStub;
  let context: DeferredCommandContext;

  beforeEach(() => {
    vi.clearAllMocks();
    stub = { listFacts: vi.fn() };
    clientsForMock.mockReturnValue({ userClient: asUserClient(stub) });
    resolveRequiredPersonalityMock.mockResolvedValue('personality-456');
    context = {
      user: { id: 'user-1' },
      interaction: {
        options: { getString: vi.fn().mockReturnValue('lilith') },
      },
      editReply: vi.fn().mockResolvedValue({ id: 'message-1', channelId: 'channel-1' }),
    } as unknown as DeferredCommandContext;
  });

  it('renders the list and persists a session keyed by the reply message', async () => {
    stub.listFacts.mockResolvedValue(listResponse([createMockFact()]));

    await handleFacts(context);

    expect(context.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: [expect.anything()] })
    );
    expect(sessionManagerMock.set).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'memory-fact-browse',
        entityId: 'message-1',
        data: { personalityId: 'personality-456', currentPage: 0 },
      })
    );
  });

  it('stops when personality resolution already replied (null contract)', async () => {
    resolveRequiredPersonalityMock.mockResolvedValue(null);

    await handleFacts(context);

    expect(stub.listFacts).not.toHaveBeenCalled();
    expect(context.editReply).not.toHaveBeenCalled();
  });

  it('degrades to a transient error message when the list fetch fails', async () => {
    stub.listFacts.mockResolvedValue(makeErr(500, 'boom'));

    await handleFacts(context);

    expect(context.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.any(String) })
    );
    expect(sessionManagerMock.set).not.toHaveBeenCalled();
  });
});

describe('handleFactsPagination', () => {
  let stub: FactClientStub;

  function createPaginationInteraction(customId: string): ButtonInteraction {
    return {
      customId,
      user: { id: 'user-1' },
      message: { id: 'message-1' },
      deferUpdate: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
      followUp: vi.fn().mockResolvedValue(undefined),
    } as unknown as ButtonInteraction;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    stub = { listFacts: vi.fn() };
    clientsForMock.mockReturnValue({ userClient: asUserClient(stub) });
  });

  it('acks first, reads the personality scope from the session, and fetches the page', async () => {
    sessionManagerMock.findByMessageId.mockResolvedValue({
      data: { personalityId: 'personality-456', currentPage: 0 },
    });
    sessionManagerMock.get.mockResolvedValue({
      data: { personalityId: 'personality-456', currentPage: 0 },
    });
    stub.listFacts.mockResolvedValue(listResponse([createMockFact()], 25));
    const interaction = createPaginationInteraction(
      factBrowseHelpers.build(2, 'all', 'date', null)
    );

    await handleFactsPagination(interaction);

    const deferOrder = vi.mocked(interaction.deferUpdate).mock.invocationCallOrder[0];
    const sessionOrder = sessionManagerMock.findByMessageId.mock.invocationCallOrder[0];
    expect(deferOrder).toBeLessThan(sessionOrder);
    expect(stub.listFacts).toHaveBeenCalledWith(
      expect.objectContaining({ personalityId: 'personality-456', offset: '20' })
    );
    expect(interaction.editReply).toHaveBeenCalled();
  });

  it('reports expiry when the session is gone', async () => {
    sessionManagerMock.findByMessageId.mockResolvedValue(null);
    const interaction = createPaginationInteraction(
      factBrowseHelpers.build(1, 'all', 'date', null)
    );

    await handleFactsPagination(interaction);

    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('expired') })
    );
    expect(stub.listFacts).not.toHaveBeenCalled();
  });
});

describe('refreshFactsList', () => {
  it('steps back a page when a forget empties the current one', async () => {
    vi.clearAllMocks();
    const stub: FactClientStub = { listFacts: vi.fn() };
    clientsForMock.mockReturnValue({ userClient: asUserClient(stub) });
    sessionManagerMock.findByMessageId.mockResolvedValue({
      data: { personalityId: 'personality-456', currentPage: 1 },
    });
    sessionManagerMock.get.mockResolvedValue({
      data: { personalityId: 'personality-456', currentPage: 1 },
    });
    // Page 1 now empty; page 0 still has facts.
    stub.listFacts
      .mockResolvedValueOnce(
        makeOk({ facts: [], total: 10, limit: 10, offset: 10, hasMore: false })
      )
      .mockResolvedValueOnce(listResponse([createMockFact()], 10));

    const interaction = {
      user: { id: 'user-1' },
      message: { id: 'message-1' },
      editReply: vi.fn().mockResolvedValue(undefined),
    } as unknown as ButtonInteraction;

    await refreshFactsList(interaction);

    expect(stub.listFacts).toHaveBeenCalledTimes(2);
    // Session advanced back to page 0.
    expect(sessionManagerMock.update).toHaveBeenCalledWith(
      'user-1',
      'memory-fact-browse',
      'message-1',
      expect.objectContaining({ currentPage: 0 })
    );
    expect(interaction.editReply).toHaveBeenCalled();
  });
});

describe('error branches', () => {
  let stub: FactClientStub;

  function createPaginationInteraction(customId: string): ButtonInteraction {
    return {
      customId,
      user: { id: 'user-1' },
      message: { id: 'message-1' },
      deferUpdate: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
      followUp: vi.fn().mockResolvedValue(undefined),
    } as unknown as ButtonInteraction;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    stub = { listFacts: vi.fn() };
    clientsForMock.mockReturnValue({ userClient: asUserClient(stub) });
  });

  it('pagination: surfaces a transient error when the page fetch fails', async () => {
    sessionManagerMock.findByMessageId.mockResolvedValue({
      data: { personalityId: 'personality-456', currentPage: 0 },
    });
    stub.listFacts.mockResolvedValue(makeErr(500, 'boom'));
    const interaction = createPaginationInteraction(
      factBrowseHelpers.build(1, 'all', 'date', null)
    );

    await handleFactsPagination(interaction);

    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.any(String) })
    );
    expect(interaction.editReply).not.toHaveBeenCalled();
  });

  it('pagination: ignores a customId its parser rejects', async () => {
    const interaction = createPaginationInteraction('something-else::entirely');

    await handleFactsPagination(interaction);

    expect(interaction.deferUpdate).not.toHaveBeenCalled();
  });

  it('handleFacts: a thrown gateway failure is classified into the reply', async () => {
    resolveRequiredPersonalityMock.mockRejectedValue(new Error('gateway exploded'));
    const context = {
      user: { id: 'user-1' },
      interaction: { options: { getString: vi.fn().mockReturnValue('lilith') } },
      editReply: vi.fn().mockResolvedValue({ id: 'message-1', channelId: 'channel-1' }),
    } as unknown as DeferredCommandContext;

    await handleFacts(context);

    expect(context.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.any(String) })
    );
  });

  it('refreshFactsList: no-ops when the session is gone or the fetch fails', async () => {
    const interaction = {
      user: { id: 'user-1' },
      message: { id: 'message-1' },
      editReply: vi.fn().mockResolvedValue(undefined),
    } as unknown as ButtonInteraction;

    sessionManagerMock.findByMessageId.mockResolvedValue(null);
    await refreshFactsList(interaction);
    expect(interaction.editReply).not.toHaveBeenCalled();

    sessionManagerMock.findByMessageId.mockResolvedValue({
      data: { personalityId: 'personality-456', currentPage: 0 },
    });
    stub.listFacts.mockResolvedValue(makeErr(500, 'boom'));
    await refreshFactsList(interaction);
    expect(interaction.editReply).not.toHaveBeenCalled();
  });
});
