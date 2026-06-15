/**
 * Tests for /models browse handlers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  ButtonInteraction,
  ChatInputCommandInteraction,
  StringSelectMenuInteraction,
} from 'discord.js';
import type { UserClient } from '@tzurot/clients';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import type { CatalogModel } from '../../utils/modelCatalog.js';
import { makeOk } from '../../test/gatewayClientStubs.js';
import { mockListWalletKeysResponse } from '@tzurot/test-factories';

vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
    modelsBrowseOptions: vi.fn(() => ({
      capability: () => undefined,
      search: () => null,
    })),
  };
});

const catalogMock = {
  fetchModelCatalog: vi.fn(),
  fetchCatalogModelById: vi.fn(),
};
vi.mock('../../utils/modelCatalog.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../utils/modelCatalog.js')>();
  return {
    ...actual,
    fetchModelCatalog: (...args: unknown[]) => catalogMock.fetchModelCatalog(...args),
    fetchCatalogModelById: (...args: unknown[]) => catalogMock.fetchCatalogModelById(...args),
  };
});

const walletStub = { listWalletKeys: vi.fn() };
vi.mock('../../utils/gatewayClients.js', () => ({
  clientsFor: vi.fn(() => ({ userClient: walletStub as unknown as UserClient })),
}));

import { modelsBrowseOptions } from '@tzurot/common-types';
import {
  handleBrowse,
  handleBrowsePagination,
  handleBrowseSelect,
  isModelsBrowseInteraction,
  isModelsBrowseSelectInteraction,
} from './browse.js';

function catalogModel(overrides: Partial<CatalogModel> & { id: string }): CatalogModel {
  return {
    name: overrides.id,
    contextLength: 200_000,
    supportsVision: false,
    supportsImageGeneration: false,
    supportsAudioInput: false,
    supportsAudioOutput: false,
    promptPricePerMillion: 3,
    completionPricePerMillion: 15,
    isZaiCoding: overrides.id.startsWith('z-ai/'),
    docsUrl: null,
    source: 'openrouter',
    hasPricing: true,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  walletStub.listWalletKeys.mockResolvedValue(makeOk(mockListWalletKeysResponse([])));
});

describe('customId predicates', () => {
  it('recognizes models browse + select customIds', () => {
    expect(isModelsBrowseInteraction('models::browse::0::all::default::')).toBe(true);
    expect(isModelsBrowseSelectInteraction('models::browse-select::0::all::default::')).toBe(true);
    expect(isModelsBrowseInteraction('character::browse::0::all::date::')).toBe(false);
  });
});

describe('handleBrowse', () => {
  function ctx(): DeferredCommandContext {
    const editReply = vi.fn();
    const interaction = { user: { id: 'u1' }, editReply } as unknown as ChatInputCommandInteraction;
    return {
      interaction,
      user: interaction.user,
      editReply,
    } as unknown as DeferredCommandContext;
  }

  it('renders the browser embed with a select menu', async () => {
    catalogMock.fetchModelCatalog.mockResolvedValue([
      catalogModel({ id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4' }),
    ]);
    const context = ctx();
    await handleBrowse(context);

    const call = vi.mocked(context.editReply).mock.calls[0][0] as {
      embeds: { data: { title: string } }[];
      components: unknown[];
    };
    expect(call.embeds[0].data.title).toBe('🤖 Model Browser');
    expect(call.components.length).toBeGreaterThan(0);
  });

  it('reports a friendly error when the fetch throws', async () => {
    catalogMock.fetchModelCatalog.mockRejectedValue(new Error('boom'));
    const context = ctx();
    await handleBrowse(context);
    expect(context.editReply).toHaveBeenCalledWith('❌ Failed to load models. Please try again.');
  });

  it('passes capability + search through to the catalog fetch', async () => {
    vi.mocked(modelsBrowseOptions).mockReturnValueOnce({
      capability: () => 'vision',
      search: () => 'claude',
    } as unknown as ReturnType<typeof modelsBrowseOptions>);
    catalogMock.fetchModelCatalog.mockResolvedValue([
      catalogModel({ id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4' }),
    ]);
    await handleBrowse(ctx());
    expect(catalogMock.fetchModelCatalog).toHaveBeenCalledWith(
      expect.objectContaining({ capability: 'vision', search: 'claude' })
    );
  });
});

describe('handleBrowsePagination', () => {
  it('defers and re-renders the requested page', async () => {
    catalogMock.fetchModelCatalog.mockResolvedValue([catalogModel({ id: 'openai/gpt-5' })]);
    const deferUpdate = vi.fn();
    const editReply = vi.fn();
    const interaction = {
      customId: 'models::browse::0::all::default::',
      user: { id: 'u1' },
      deferUpdate,
      editReply,
    } as unknown as ButtonInteraction;

    await handleBrowsePagination(interaction);
    expect(deferUpdate).toHaveBeenCalled();
    expect(editReply).toHaveBeenCalled();
  });

  it('ignores an unparseable customId', async () => {
    const deferUpdate = vi.fn();
    const interaction = {
      customId: 'not-a-models-browse',
      deferUpdate,
    } as unknown as ButtonInteraction;
    await handleBrowsePagination(interaction);
    expect(deferUpdate).not.toHaveBeenCalled();
  });

  it('notifies the user (followUp) when page load fails', async () => {
    catalogMock.fetchModelCatalog.mockRejectedValue(new Error('boom'));
    const followUp = vi.fn();
    const interaction = {
      customId: 'models::browse::0::all::default::',
      user: { id: 'u1' },
      deferUpdate: vi.fn(),
      editReply: vi.fn(),
      followUp,
    } as unknown as ButtonInteraction;

    await handleBrowsePagination(interaction);
    const call = followUp.mock.calls[0][0] as { content: string };
    expect(call.content).toContain('Failed to load that page');
  });
});

describe('sort modes', () => {
  /** Pull the rendered embed description out of the pagination editReply call. */
  function renderViaPagination(customId: string): Promise<string> {
    const editReply = vi.fn();
    const interaction = {
      customId,
      user: { id: 'u1' },
      deferUpdate: vi.fn(),
      editReply,
    } as unknown as ButtonInteraction;
    return handleBrowsePagination(interaction).then(() => {
      const call = editReply.mock.calls[0][0] as { embeds: { data: { description: string } }[] };
      return call.embeds[0].data.description;
    });
  }

  it('default sort labels the embed with usable-first ordering', async () => {
    catalogMock.fetchModelCatalog.mockResolvedValue([catalogModel({ id: 'a/model', name: 'A' })]);
    const description = await renderViaPagination('models::browse::0::all::default::');
    expect(description).toContain('sorted: usable first');
  });

  it('price sort lists cheaper models first and labels the embed', async () => {
    catalogMock.fetchModelCatalog.mockResolvedValue([
      catalogModel({ id: 'pricey/model', name: 'Pricey', promptPricePerMillion: 100 }),
      catalogModel({ id: 'cheap/model', name: 'Cheap', promptPricePerMillion: 1 }),
    ]);
    const description = await renderViaPagination('models::browse::0::all::price::');
    expect(description).toContain('sorted: cheapest first');
    expect(description.indexOf('cheap/model')).toBeLessThan(description.indexOf('pricey/model'));
  });

  it('price sort drops models without pricing to the end', async () => {
    // z.ai-catalog-only entries and meta-routers have no per-token price; the
    // `priceRank` +Infinity fallback should sort them last, behind any $ model.
    catalogMock.fetchModelCatalog.mockResolvedValue([
      catalogModel({ id: 'no-price/model', name: 'NoPricing', hasPricing: false }),
      catalogModel({
        id: 'priced/model',
        name: 'Priced',
        promptPricePerMillion: 5,
        hasPricing: true,
      }),
    ]);
    const description = await renderViaPagination('models::browse::0::all::price::');
    expect(description.indexOf('priced/model')).toBeLessThan(description.indexOf('no-price/model'));
  });

  it('recent sort lists newer models first and labels the embed', async () => {
    catalogMock.fetchModelCatalog.mockResolvedValue([
      catalogModel({ id: 'old/model', name: 'Old', created: 1_000 }),
      catalogModel({ id: 'new/model', name: 'New', created: 9_999 }),
    ]);
    const description = await renderViaPagination('models::browse::0::all::recent::');
    expect(description).toContain('sorted: newest first');
    expect(description.indexOf('new/model')).toBeLessThan(description.indexOf('old/model'));
  });

  it('recent sort drops models without a created timestamp to the end', async () => {
    // z.ai-catalog-only entries carry no `created`; they should sort last
    // (the `?? NEGATIVE_INFINITY` fallback), never ahead of timestamped models.
    catalogMock.fetchModelCatalog.mockResolvedValue([
      catalogModel({ id: 'no-date/model', name: 'NoDate', created: undefined }),
      catalogModel({ id: 'dated/model', name: 'Dated', created: 5_000 }),
    ]);
    const description = await renderViaPagination('models::browse::0::all::recent::');
    expect(description.indexOf('dated/model')).toBeLessThan(description.indexOf('no-date/model'));
  });

  it('rejects a customId carrying an invalid sort segment', async () => {
    const deferUpdate = vi.fn();
    const interaction = {
      customId: 'models::browse::0::all::bogus::',
      deferUpdate,
    } as unknown as ButtonInteraction;
    await handleBrowsePagination(interaction);
    expect(deferUpdate).not.toHaveBeenCalled();
  });
});

describe('handleBrowseSelect', () => {
  function selectInteraction(value: string): StringSelectMenuInteraction {
    return {
      values: [value],
      user: { id: 'u1' },
      deferUpdate: vi.fn(),
      followUp: vi.fn(),
    } as unknown as StringSelectMenuInteraction;
  }

  it('renders the card for the selected model', async () => {
    catalogMock.fetchCatalogModelById.mockResolvedValue(
      catalogModel({ id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4' })
    );
    const interaction = selectInteraction('anthropic/claude-sonnet-4');
    await handleBrowseSelect(interaction);

    const call = vi.mocked(interaction.followUp).mock.calls[0][0] as {
      embeds: { data: { title: string } }[];
    };
    expect(call.embeds[0].data.title).toBe('Claude Sonnet 4');
  });

  it('reports not-found when the model is missing', async () => {
    catalogMock.fetchCatalogModelById.mockResolvedValue(null);
    const interaction = selectInteraction('ghost/model');
    await handleBrowseSelect(interaction);
    const call = vi.mocked(interaction.followUp).mock.calls[0][0] as { content: string };
    expect(call.content).toContain('not found');
  });
});
