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
    expect(isModelsBrowseInteraction('models::browse::0::all::')).toBe(true);
    expect(isModelsBrowseSelectInteraction('models::browse-select::0::all::')).toBe(true);
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
});

describe('handleBrowsePagination', () => {
  it('defers and re-renders the requested page', async () => {
    catalogMock.fetchModelCatalog.mockResolvedValue([catalogModel({ id: 'openai/gpt-5' })]);
    const deferUpdate = vi.fn();
    const editReply = vi.fn();
    const interaction = {
      customId: 'models::browse::0::all::',
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
      customId: 'models::browse::0::all::',
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
