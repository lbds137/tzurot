/**
 * Tests for /models view handler.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChatInputCommandInteraction } from 'discord.js';
import type { UserClient } from '@tzurot/clients';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import type { CatalogModel } from '../../utils/modelCatalog.js';
import { makeOk, makeErr } from '../../test/gatewayClientStubs.js';
import { mockListWalletKeysResponse } from '@tzurot/test-factories';

let viewModelId = 'anthropic/claude-sonnet-4';
vi.mock('@tzurot/common-types/generated/commandOptions', async () => {
  const actual = await vi.importActual<
    typeof import('@tzurot/common-types/generated/commandOptions')
  >('@tzurot/common-types/generated/commandOptions');
  return {
    ...actual,
    modelsViewOptions: vi.fn(() => ({ model: () => viewModelId })),
  };
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

const catalogMock = { fetchCatalogModelById: vi.fn() };
vi.mock('../../utils/modelCatalog.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../utils/modelCatalog.js')>();
  return {
    ...actual,
    fetchCatalogModelById: (...args: unknown[]) => catalogMock.fetchCatalogModelById(...args),
  };
});

const walletStub = { listWalletKeys: vi.fn() };
vi.mock('../../utils/gatewayClients.js', () => ({
  clientsFor: vi.fn(() => ({ userClient: walletStub as unknown as UserClient })),
}));

import { handleView } from './view.js';

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
    isZaiCoding: false,
    docsUrl: null,
    source: 'openrouter',
    hasPricing: true,
    ...overrides,
  };
}

function ctx(): DeferredCommandContext {
  const editReply = vi.fn();
  const interaction = { user: { id: 'u1' }, editReply } as unknown as ChatInputCommandInteraction;
  return { interaction, user: interaction.user, editReply } as unknown as DeferredCommandContext;
}

beforeEach(() => {
  vi.clearAllMocks();
  viewModelId = 'anthropic/claude-sonnet-4';
  walletStub.listWalletKeys.mockResolvedValue(makeOk(mockListWalletKeysResponse([])));
});

describe('handleView', () => {
  it('renders the card for an existing model', async () => {
    catalogMock.fetchCatalogModelById.mockResolvedValue(
      catalogModel({ id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4' })
    );
    const context = ctx();
    await handleView(context);
    const call = vi.mocked(context.editReply).mock.calls[0][0] as {
      embeds: { data: { title: string } }[];
    };
    expect(call.embeds[0].data.title).toBe('Claude Sonnet 4');
  });

  it('renders the piggyback model as UNKNOWN (not free) when the wallet fetch fails', async () => {
    // A failed wallet fetch means keys are UNKNOWN — a key-holder viewing the
    // conditionally-free model mid-blip must not be told it is free (they are
    // billed on their own key). Empty-Set-on-failure regressed exactly this.
    viewModelId = 'z-ai/glm-4.5-air';
    catalogMock.fetchCatalogModelById.mockResolvedValue(
      catalogModel({ id: 'z-ai/glm-4.5-air', name: 'GLM 4.5 Air', source: 'both' })
    );
    walletStub.listWalletKeys.mockResolvedValue(makeErr(500, 'wallet down'));
    const context = ctx();
    await handleView(context);

    const call = vi.mocked(context.editReply).mock.calls[0][0] as {
      embeds: { data: { fields?: { name: string; value: string }[] } }[];
    };
    const rendered = JSON.stringify(call.embeds[0].data);
    expect(rendered).not.toContain('Free');
  });

  it('renders the piggyback model as free for a CONFIRMED keyless user', async () => {
    viewModelId = 'z-ai/glm-4.5-air';
    catalogMock.fetchCatalogModelById.mockResolvedValue(
      catalogModel({ id: 'z-ai/glm-4.5-air', name: 'GLM 4.5 Air', source: 'both' })
    );
    // beforeEach default: wallet fetch OK with zero keys = confirmed guest
    const context = ctx();
    await handleView(context);

    const call = vi.mocked(context.editReply).mock.calls[0][0] as {
      embeds: { data: unknown }[];
    };
    expect(JSON.stringify(call.embeds[0].data)).toContain('Free');
  });

  it('reports a not-found message for an unknown slug', async () => {
    viewModelId = 'ghost/model';
    catalogMock.fetchCatalogModelById.mockResolvedValue(null);
    const context = ctx();
    await handleView(context);
    expect(context.editReply).toHaveBeenCalledWith(expect.stringContaining('not found'));
  });

  it('reports a friendly error when the lookup throws', async () => {
    catalogMock.fetchCatalogModelById.mockRejectedValue(new Error('boom'));
    const context = ctx();
    await handleView(context);
    expect(context.editReply).toHaveBeenCalledWith(
      '❌ Failed to load the model. Please try again.'
    );
  });
});
