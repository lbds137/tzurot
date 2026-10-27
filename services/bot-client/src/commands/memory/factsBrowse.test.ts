/**
 * Tests for the Memory Facts browser (/memory facts).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageFlags, type ButtonInteraction } from 'discord.js';
import {
  FACT_BROWSE_PREFIX,
  FACTS_FORGOTTEN_REFRESH_COPY,
  FACTS_SESSION_EXPIRED,
  factBrowseHelpers,
  followUpFactsRefusal,
  isFactBrowsePagination,
  handleFacts,
  handleFactsPagination,
  refreshFactsList,
} from './factsBrowse.js';
import type { FactItem } from './factsApi.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { PAGE_FETCH_FAILED_COPY } from '../../utils/browse/multiSelectBatch.js';
import { CATALOG } from '../../ux/catalog/catalog.js';
import { renderSpec } from '../../ux/render/render.js';
import { makeOk, makeErr, asUserClient } from '../../test/gatewayClientStubs.js';

const { loggerMock } = vi.hoisted(() => ({
  loggerMock: {
    debug: vi.fn(),
    info: vi.fn(),
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

/** `getString` behaves like discord.js: distinct values per option name. */
function makeGetString(values: Record<string, string | null>) {
  return vi.fn((name: string) => values[name] ?? null);
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
        options: { getString: makeGetString({ character: 'lilith' }) },
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

    // Shared list builder: §2.1 title; statements render UNBOLDED
    // (nameMarkup override — sentences, not entity names) with the
    // learned-date metadata line.
    const embedData = (
      vi.mocked(context.editReply).mock.calls[0][0] as {
        embeds: { data: { title: string; description: string; footer: { text: string } } }[];
      }
    ).embeds[0].data;
    expect(embedData.title).toBe('🧠 Known Facts');
    expect(embedData.description).toContain('**1.** The user has a cat named Miso');
    expect(embedData.description).toContain('└ <t:1781524800:D>');
    // No tag filter active — footer is byte-identical to the untagged shape.
    expect(embedData.footer.text).toBe('1 fact • Locked 🔐 · Corrected 📝');
    expect(sessionManagerMock.set).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'memory-fact-browse',
        entityId: 'message-1',
        data: { personalityId: 'personality-456', currentPage: 0 },
      })
    );
  });

  it('renders the tag in the footer and persists it in the session when a tag filter is active', async () => {
    stub.listFacts.mockResolvedValue(listResponse([createMockFact()]));
    const taggedContext = {
      user: { id: 'user-1' },
      interaction: {
        options: { getString: makeGetString({ character: 'lilith', tag: 'commitment:promise' }) },
      },
      editReply: vi.fn().mockResolvedValue({ id: 'message-1', channelId: 'channel-1' }),
    } as unknown as DeferredCommandContext;

    await handleFacts(taggedContext);

    expect(stub.listFacts).toHaveBeenCalledWith(
      expect.objectContaining({ tag: 'commitment:promise' })
    );

    const embedData = (
      vi.mocked(taggedContext.editReply).mock.calls[0][0] as {
        embeds: { data: { footer: { text: string } } }[];
      }
    ).embeds[0].data;
    expect(embedData.footer.text).toContain('tag: commitment:promise');

    expect(sessionManagerMock.set).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { personalityId: 'personality-456', currentPage: 0, tag: 'commitment:promise' },
      })
    );
  });

  it('renders the query in the footer and persists it in the session when a query filter is active', async () => {
    stub.listFacts.mockResolvedValue(listResponse([createMockFact()]));
    const queryContext = {
      user: { id: 'user-1' },
      interaction: {
        options: { getString: makeGetString({ character: 'lilith', query: 'monster' }) },
      },
      editReply: vi.fn().mockResolvedValue({ id: 'message-1', channelId: 'channel-1' }),
    } as unknown as DeferredCommandContext;

    await handleFacts(queryContext);

    expect(stub.listFacts).toHaveBeenCalledWith(expect.objectContaining({ query: 'monster' }));

    const embedData = (
      vi.mocked(queryContext.editReply).mock.calls[0][0] as {
        embeds: { data: { footer: { text: string } } }[];
      }
    ).embeds[0].data;
    expect(embedData.footer.text).toContain('query: "monster"');

    expect(sessionManagerMock.set).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { personalityId: 'personality-456', currentPage: 0, query: 'monster' },
      })
    );
  });

  it('renders raw unescaped query text in the footer', async () => {
    stub.listFacts.mockResolvedValue(listResponse([createMockFact()]));
    const queryContext = {
      user: { id: 'user-1' },
      interaction: {
        options: { getString: makeGetString({ character: 'lilith', query: '*bold* _italic_' }) },
      },
      editReply: vi.fn().mockResolvedValue({ id: 'message-1', channelId: 'channel-1' }),
    } as unknown as DeferredCommandContext;

    await handleFacts(queryContext);

    const embedData = (
      vi.mocked(queryContext.editReply).mock.calls[0][0] as {
        embeds: { data: { footer: { text: string } } }[];
      }
    ).embeds[0].data;
    expect(embedData.footer.text).toContain('query: "*bold* _italic_"');
  });

  it('renders both tag and query in footer and session when both filters are active', async () => {
    stub.listFacts.mockResolvedValue(listResponse([createMockFact()]));
    const filterContext = {
      user: { id: 'user-1' },
      interaction: {
        options: {
          getString: makeGetString({
            character: 'lilith',
            tag: 'commitment:promise',
            query: 'monster',
          }),
        },
      },
      editReply: vi.fn().mockResolvedValue({ id: 'message-1', channelId: 'channel-1' }),
    } as unknown as DeferredCommandContext;

    await handleFacts(filterContext);

    expect(stub.listFacts).toHaveBeenCalledWith(
      expect.objectContaining({ tag: 'commitment:promise', query: 'monster' })
    );

    const embedData = (
      vi.mocked(filterContext.editReply).mock.calls[0][0] as {
        embeds: { data: { footer: { text: string } } }[];
      }
    ).embeds[0].data;
    expect(embedData.footer.text).toContain('tag: commitment:promise');
    expect(embedData.footer.text).toContain('query: "monster"');

    expect(sessionManagerMock.set).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          personalityId: 'personality-456',
          currentPage: 0,
          tag: 'commitment:promise',
          query: 'monster',
        },
      })
    );
  });

  it('shows the query-specific empty message when a query filter returns zero facts', async () => {
    stub.listFacts.mockResolvedValue(listResponse([], 0));
    const queryContext = {
      user: { id: 'user-1' },
      interaction: {
        options: { getString: makeGetString({ character: 'lilith', query: 'monster' }) },
      },
      editReply: vi.fn().mockResolvedValue({ id: 'message-1', channelId: 'channel-1' }),
    } as unknown as DeferredCommandContext;

    await handleFacts(queryContext);

    const embedData = (
      vi.mocked(queryContext.editReply).mock.calls[0][0] as {
        embeds: { data: { description: string; footer: { text: string } } }[];
      }
    ).embeds[0].data;
    expect(embedData.description).toBe(
      'No facts match that query — try browsing without a filter.'
    );
    expect(embedData.footer.text).toContain('0 facts');
    expect(embedData.footer.text).toContain('query: "monster"');
  });

  it('shows the combined empty message when both tag and query return zero facts', async () => {
    stub.listFacts.mockResolvedValue(listResponse([], 0));
    const filterContext = {
      user: { id: 'user-1' },
      interaction: {
        options: {
          getString: makeGetString({
            character: 'lilith',
            tag: 'commitment:advice',
            query: 'monster',
          }),
        },
      },
      editReply: vi.fn().mockResolvedValue({ id: 'message-1', channelId: 'channel-1' }),
    } as unknown as DeferredCommandContext;

    await handleFacts(filterContext);

    const embedData = (
      vi.mocked(filterContext.editReply).mock.calls[0][0] as {
        embeds: { data: { description: string; footer: { text: string } } }[];
      }
    ).embeds[0].data;
    expect(embedData.description).toBe(
      'No facts match that query and carry that tag — try browsing without a filter.'
    );
    expect(embedData.footer.text).toContain('0 facts');
    expect(embedData.footer.text).toContain('tag: commitment:advice');
    expect(embedData.footer.text).toContain('query: "monster"');
  });

  it('renders both badges as a joined glyph run when a fact is locked AND corrected', async () => {
    stub.listFacts.mockResolvedValue(
      listResponse([createMockFact({ isLocked: true, tier: 'corrected' })])
    );

    await handleFacts(context);

    const embedData = (
      vi.mocked(context.editReply).mock.calls[0][0] as {
        embeds: { data: { description: string } }[];
      }
    ).embeds[0].data;
    // Established multi-badge convention: concatenated run, no separator.
    expect(embedData.description).toContain('**1.** 🔐📝 The user has a cat named Miso');
  });

  it('renders the Select-several toggle on the browse message', async () => {
    stub.listFacts.mockResolvedValue(listResponse([createMockFact()]));

    await handleFacts(context);

    const call = vi.mocked(context.editReply).mock.calls[0][0] as unknown as {
      components: { toJSON(): { components: { custom_id?: string; label?: string }[] } }[];
    };
    const buttons = call.components.flatMap(row => row.toJSON().components);
    const toggle = buttons.find(button => button.custom_id === 'memory-fact::batch-select');
    expect(toggle?.label).toBe('Select several');
  });

  it('stops when personality resolution already replied (null contract)', async () => {
    resolveRequiredPersonalityMock.mockResolvedValue(null);

    await handleFacts(context);

    expect(stub.listFacts).not.toHaveBeenCalled();
    expect(context.editReply).not.toHaveBeenCalled();
  });

  it('shows the tag-specific empty message when a tag filter returns zero facts', async () => {
    stub.listFacts.mockResolvedValue(listResponse([], 0));
    const taggedContext = {
      user: { id: 'user-1' },
      interaction: {
        options: { getString: makeGetString({ character: 'lilith', tag: 'commitment:advice' }) },
      },
      editReply: vi.fn().mockResolvedValue({ id: 'message-1', channelId: 'channel-1' }),
    } as unknown as DeferredCommandContext;

    await handleFacts(taggedContext);

    const embedData = (
      vi.mocked(taggedContext.editReply).mock.calls[0][0] as {
        embeds: { data: { description: string; footer: { text: string } } }[];
      }
    ).embeds[0].data;
    expect(embedData.description).toBe('No facts carry that tag — try browsing without a filter.');
    expect(embedData.footer.text).toContain('0 facts');
    expect(embedData.footer.text).toContain('tag: commitment:advice');
  });

  it('shows the generic empty message when browsing without a tag returns zero facts', async () => {
    stub.listFacts.mockResolvedValue(listResponse([], 0));

    await handleFacts(context);

    const embedData = (
      vi.mocked(context.editReply).mock.calls[0][0] as {
        embeds: { data: { description: string } }[];
      }
    ).embeds[0].data;
    expect(embedData.description).toBe(
      "This character hasn't learned any facts about you yet — facts are distilled automatically from your conversations."
    );
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

  it('forwards the session tag to the page fetch', async () => {
    sessionManagerMock.findByMessageId.mockResolvedValue({
      data: { personalityId: 'personality-456', currentPage: 0, tag: 'commitment:promise' },
    });
    sessionManagerMock.get.mockResolvedValue({
      data: { personalityId: 'personality-456', currentPage: 0, tag: 'commitment:promise' },
    });
    stub.listFacts.mockResolvedValue(listResponse([createMockFact()], 25));
    const interaction = createPaginationInteraction(
      factBrowseHelpers.build(1, 'all', 'date', null)
    );

    await handleFactsPagination(interaction);

    expect(stub.listFacts).toHaveBeenCalledWith(
      expect.objectContaining({ tag: 'commitment:promise' })
    );
  });

  it('forwards the session query to the page fetch', async () => {
    sessionManagerMock.findByMessageId.mockResolvedValue({
      data: { personalityId: 'personality-456', currentPage: 0, query: 'monster' },
    });
    sessionManagerMock.get.mockResolvedValue({
      data: { personalityId: 'personality-456', currentPage: 0, query: 'monster' },
    });
    stub.listFacts.mockResolvedValue(listResponse([createMockFact()], 25));
    const interaction = createPaginationInteraction(
      factBrowseHelpers.build(1, 'all', 'date', null)
    );

    await handleFactsPagination(interaction);

    expect(stub.listFacts).toHaveBeenCalledWith(expect.objectContaining({ query: 'monster' }));
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

  it('keeps the session tag across the re-fetch', async () => {
    vi.clearAllMocks();
    const stub: FactClientStub = { listFacts: vi.fn() };
    clientsForMock.mockReturnValue({ userClient: asUserClient(stub) });
    sessionManagerMock.findByMessageId.mockResolvedValue({
      data: { personalityId: 'personality-456', currentPage: 0, tag: 'commitment:promise' },
    });
    stub.listFacts.mockResolvedValue(listResponse([createMockFact()], 1));

    const interaction = {
      user: { id: 'user-1' },
      message: { id: 'message-1' },
      editReply: vi.fn().mockResolvedValue(undefined),
    } as unknown as ButtonInteraction;

    await refreshFactsList(interaction);

    expect(stub.listFacts).toHaveBeenCalledWith(
      expect.objectContaining({ tag: 'commitment:promise' })
    );
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
      interaction: { options: { getString: makeGetString({ character: 'lilith' }) } },
      editReply: vi.fn().mockResolvedValue({ id: 'message-1', channelId: 'channel-1' }),
    } as unknown as DeferredCommandContext;

    await handleFacts(context);

    expect(context.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.any(String) })
    );
  });

  it('refreshFactsList: sends the expiry followUp when the session is gone', async () => {
    const interaction = {
      user: { id: 'user-1' },
      message: { id: 'message-1' },
      editReply: vi.fn().mockResolvedValue(undefined),
      followUp: vi.fn().mockResolvedValue(undefined),
    } as unknown as ButtonInteraction;

    sessionManagerMock.findByMessageId.mockResolvedValue(null);
    await refreshFactsList(interaction);

    expect(interaction.followUp).toHaveBeenCalledTimes(1);
    expect(interaction.followUp).toHaveBeenCalledWith({
      content: FACTS_SESSION_EXPIRED,
      flags: MessageFlags.Ephemeral,
    });
    expect(interaction.editReply).not.toHaveBeenCalled();
  });

  it('refreshFactsList: sends the transient error followUp when the fetch fails', async () => {
    const interaction = {
      user: { id: 'user-1' },
      message: { id: 'message-1' },
      editReply: vi.fn().mockResolvedValue(undefined),
      followUp: vi.fn().mockResolvedValue(undefined),
    } as unknown as ButtonInteraction;

    sessionManagerMock.findByMessageId.mockResolvedValue({
      data: { personalityId: 'personality-456', currentPage: 0 },
    });
    stub.listFacts.mockResolvedValue(makeErr(500, 'boom'));
    await refreshFactsList(interaction);

    expect(interaction.followUp).toHaveBeenCalledTimes(1);
    expect(interaction.followUp).toHaveBeenCalledWith({
      content: renderSpec(CATALOG.error.transient(PAGE_FETCH_FAILED_COPY)),
      flags: MessageFlags.Ephemeral,
    });
    expect(interaction.followUp).not.toHaveBeenCalledWith(
      expect.objectContaining({ content: FACTS_SESSION_EXPIRED })
    );
    expect(interaction.editReply).not.toHaveBeenCalled();
  });

  it('refreshFactsList: sends the transient error followUp when the step-back retry fetch fails', async () => {
    const interaction = {
      user: { id: 'user-1' },
      message: { id: 'message-1' },
      editReply: vi.fn().mockResolvedValue(undefined),
      followUp: vi.fn().mockResolvedValue(undefined),
    } as unknown as ButtonInteraction;

    sessionManagerMock.findByMessageId.mockResolvedValue({
      data: { personalityId: 'personality-456', currentPage: 1 },
    });
    stub.listFacts
      .mockResolvedValueOnce(
        makeOk({ facts: [], total: 10, limit: 10, offset: 10, hasMore: false })
      )
      .mockResolvedValueOnce(makeErr(500, 'boom'));

    await refreshFactsList(interaction);

    expect(stub.listFacts).toHaveBeenCalledTimes(2);
    expect(interaction.followUp).toHaveBeenCalledTimes(1);
    expect(interaction.followUp).toHaveBeenCalledWith({
      content: renderSpec(CATALOG.error.transient(PAGE_FETCH_FAILED_COPY)),
      flags: MessageFlags.Ephemeral,
    });
    expect(interaction.editReply).not.toHaveBeenCalled();
  });

  it('followUpFactsRefusal: logs warn with ids only on fetch-failed and not on session-gone', async () => {
    const interaction = {
      user: { id: 'user-1' },
      message: { id: 'message-1' },
      followUp: vi.fn().mockResolvedValue(undefined),
    } as unknown as ButtonInteraction;

    await followUpFactsRefusal(interaction, 'session-gone');
    expect(loggerMock.warn).not.toHaveBeenCalled();

    await followUpFactsRefusal(interaction, 'fetch-failed');
    expect(loggerMock.warn).toHaveBeenCalledTimes(1);
    expect(loggerMock.warn).toHaveBeenCalledWith(
      { userId: 'user-1', messageId: 'message-1' },
      'Facts list could not be shown: page fetch failed'
    );
  });

  it('followUpFactsRefusal: swallows and logs a rejected followUp', async () => {
    const followUpError = new Error('webhook token expired');
    const interaction = {
      user: { id: 'user-1' },
      message: { id: 'message-1' },
      followUp: vi.fn().mockRejectedValue(followUpError),
    } as unknown as ButtonInteraction;

    await expect(followUpFactsRefusal(interaction, 'session-gone')).resolves.toBeUndefined();

    expect(loggerMock.warn).toHaveBeenCalledWith(
      { err: followUpError, userId: 'user-1', messageId: 'message-1' },
      expect.any(String)
    );
  });

  it('followUpFactsRefusal: sends FACTS_FORGOTTEN_REFRESH_COPY on session-gone when afterForget is true', async () => {
    const interaction = {
      user: { id: 'user-1' },
      message: { id: 'message-1' },
      followUp: vi.fn().mockResolvedValue(undefined),
    } as unknown as ButtonInteraction;

    await followUpFactsRefusal(interaction, 'session-gone', { afterForget: true });

    expect(interaction.followUp).toHaveBeenCalledTimes(1);
    expect(interaction.followUp).toHaveBeenCalledWith({
      content: renderSpec(CATALOG.info.warning(FACTS_FORGOTTEN_REFRESH_COPY)),
      flags: MessageFlags.Ephemeral,
    });
    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining(FACTS_FORGOTTEN_REFRESH_COPY),
      })
    );
    expect(loggerMock.warn).not.toHaveBeenCalled();
  });

  it('followUpFactsRefusal: sends FACTS_FORGOTTEN_REFRESH_COPY and logs warn on fetch-failed when afterForget is true', async () => {
    const interaction = {
      user: { id: 'user-1' },
      message: { id: 'message-1' },
      followUp: vi.fn().mockResolvedValue(undefined),
    } as unknown as ButtonInteraction;

    await followUpFactsRefusal(interaction, 'fetch-failed', { afterForget: true });

    expect(interaction.followUp).toHaveBeenCalledTimes(1);
    expect(interaction.followUp).toHaveBeenCalledWith({
      content: renderSpec(CATALOG.info.warning(FACTS_FORGOTTEN_REFRESH_COPY)),
      flags: MessageFlags.Ephemeral,
    });
    expect(loggerMock.warn).toHaveBeenCalledTimes(1);
    expect(loggerMock.warn).toHaveBeenCalledWith(
      { userId: 'user-1', messageId: 'message-1' },
      'Facts list could not be shown: page fetch failed'
    );
  });

  it('refreshFactsList: confirms the forget when the session is gone after a forget', async () => {
    const interaction = {
      user: { id: 'user-1' },
      message: { id: 'message-1' },
      editReply: vi.fn().mockResolvedValue(undefined),
      followUp: vi.fn().mockResolvedValue(undefined),
    } as unknown as ButtonInteraction;

    sessionManagerMock.findByMessageId.mockResolvedValue(null);
    await refreshFactsList(interaction, { afterForget: true });

    expect(interaction.followUp).toHaveBeenCalledTimes(1);
    expect(interaction.followUp).toHaveBeenCalledWith({
      content: renderSpec(CATALOG.info.warning(FACTS_FORGOTTEN_REFRESH_COPY)),
      flags: MessageFlags.Ephemeral,
    });
    expect(interaction.followUp).not.toHaveBeenCalledWith(
      expect.objectContaining({ content: FACTS_SESSION_EXPIRED })
    );
    expect(interaction.followUp).not.toHaveBeenCalledWith(
      expect.objectContaining({
        content: renderSpec(CATALOG.error.transient(PAGE_FETCH_FAILED_COPY)),
      })
    );
    expect(interaction.editReply).not.toHaveBeenCalled();
  });

  it('refreshFactsList: confirms the forget when the fetch fails after a forget', async () => {
    const interaction = {
      user: { id: 'user-1' },
      message: { id: 'message-1' },
      editReply: vi.fn().mockResolvedValue(undefined),
      followUp: vi.fn().mockResolvedValue(undefined),
    } as unknown as ButtonInteraction;

    sessionManagerMock.findByMessageId.mockResolvedValue({
      data: { personalityId: 'personality-456', currentPage: 0 },
    });
    stub.listFacts.mockResolvedValue(makeErr(500, 'boom'));
    await refreshFactsList(interaction, { afterForget: true });

    expect(interaction.followUp).toHaveBeenCalledTimes(1);
    expect(interaction.followUp).toHaveBeenCalledWith({
      content: renderSpec(CATALOG.info.warning(FACTS_FORGOTTEN_REFRESH_COPY)),
      flags: MessageFlags.Ephemeral,
    });
    expect(interaction.followUp).not.toHaveBeenCalledWith(
      expect.objectContaining({ content: FACTS_SESSION_EXPIRED })
    );
    expect(interaction.followUp).not.toHaveBeenCalledWith(
      expect.objectContaining({
        content: renderSpec(CATALOG.error.transient(PAGE_FETCH_FAILED_COPY)),
      })
    );
    expect(interaction.editReply).not.toHaveBeenCalled();
  });
});
