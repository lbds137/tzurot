/**
 * Tests for Preset Browse Handler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ButtonInteraction, StringSelectMenuInteraction } from 'discord.js';
import { mockListLlmConfigsResponse, mockListWalletKeysResponse } from '@tzurot/test-factories';
import { makeOk, makeErr, asUserClient } from '../../test/gatewayClientStubs.js';
import { registerBrowseRebuilder } from '../../utils/dashboard/index.js';

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
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

const clientsForMock = vi.hoisted(() => vi.fn());
vi.mock('../../utils/gatewayClients.js', () => ({
  clientsFor: clientsForMock,
}));

// Mock dashboard utilities
const mockBuildDashboardEmbed = vi.fn(() => ({ toJSON: () => ({ title: 'Dashboard' }) }));
const mockBuildDashboardComponents = vi.fn(() => []);
const mockSessionManagerSet = vi.fn();
vi.mock('../../utils/dashboard/index.js', () => ({
  buildDashboardEmbed: (...args: unknown[]) =>
    mockBuildDashboardEmbed(...(args as Parameters<typeof mockBuildDashboardEmbed>)),
  buildDashboardComponents: (...args: unknown[]) =>
    mockBuildDashboardComponents(...(args as Parameters<typeof mockBuildDashboardComponents>)),
  getSessionManager: () => ({
    set: mockSessionManagerSet,
  }),
  registerBrowseRebuilder: vi.fn(),
}));

// Mock preset api
const mockFetchPreset = vi.fn();
vi.mock('./api.js', () => ({
  fetchPreset: (...args: unknown[]) => mockFetchPreset(...args),
}));

// Mock preset config
vi.mock('./config.js', () => ({
  PRESET_DASHBOARD_CONFIG: { sections: [] },
  flattenPresetData: (data: Record<string, unknown>) => ({ ...data, isOwned: data.isOwned }),
  buildPresetDashboardOptions: vi.fn().mockReturnValue({
    showBack: false,
    showClose: true,
    showRefresh: true,
    showClone: true,
    showDelete: false,
  }),
}));

const {
  handleBrowse,
  handleBrowsePagination,
  handleBrowseSelect,
  isPresetBrowseInteraction,
  isPresetBrowseSelectInteraction,
} = await import('./browse.js');

interface UserClientStub {
  listUserLlmConfigs: ReturnType<typeof vi.fn>;
  listWalletKeys: ReturnType<typeof vi.fn>;
}

function createStub(): UserClientStub {
  return { listUserLlmConfigs: vi.fn(), listWalletKeys: vi.fn() };
}

function configurePresets(
  stub: UserClientStub,
  presets: Parameters<typeof mockListLlmConfigsResponse>[0],
  hasWallet = true,
  visionPresets: Parameters<typeof mockListLlmConfigsResponse>[0] = []
): void {
  // Browse issues ONE unscoped call and filters by capability client-side,
  // so the mock just returns the full set. The 👁 badge + capability filter key
  // off `supportsVision` — text rows are text-only, vision rows vision-capable.
  const textRows = (presets ?? []).map(p => ({
    ...p,
    supportsVision: false,
  }));
  const visionRows = visionPresets.map(p => ({
    ...p,
    supportsVision: true,
  }));
  stub.listUserLlmConfigs.mockResolvedValue(
    makeOk(mockListLlmConfigsResponse([...textRows, ...visionRows]))
  );
  stub.listWalletKeys.mockResolvedValue(
    makeOk(mockListWalletKeysResponse(hasWallet ? [{ isActive: true }] : []))
  );
}

describe('handleBrowse', () => {
  const mockEditReply = vi.fn();
  let stub: UserClientStub;

  beforeEach(() => {
    vi.clearAllMocks();
    stub = createStub();
    clientsForMock.mockReturnValue({ userClient: asUserClient(stub) });
  });

  function createMockContext(
    query: string | null = null,
    filter: string | null = null,
    capability: string | null = null
  ) {
    return {
      user: { id: '123456789', username: 'testuser' },
      interaction: {
        options: {
          getString: vi.fn((name: string) => {
            if (name === 'query') return query;
            if (name === 'filter') return filter;
            if (name === 'capability') return capability;
            return null;
          }),
        },
      },
      editReply: mockEditReply,
    } as unknown as Parameters<typeof handleBrowse>[0];
  }

  it('renders the z.ai piggyback preset as available (not struck) for guests', async () => {
    // GLM-4.5-Air is free-tier ELIGIBLE: a guest's browse must not strike it
    // through or claim it "(requires API key)" — same class as the picker gate.
    configurePresets(
      stub,
      [
        {
          id: '00000000-0000-4000-8000-00000000000a',
          name: 'GLM Air',
          model: 'z-ai/glm-4.5-air',
          provider: 'openrouter',
          isGlobal: true,
          isDefault: false,
          isOwned: false,
        },
      ],
      false // no wallet = guest mode
    );

    await handleBrowse(createMockContext());

    const payload = mockEditReply.mock.calls[0][0] as {
      embeds: { data: { description?: string } }[];
      components: { components: { data: { options?: { description?: string }[] } }[] }[];
    };
    const description = payload.embeds[0].data.description ?? '';
    expect(description).toContain('**GLM Air**');
    expect(description).not.toContain('~~GLM Air~~');
    // Guest-aware 🆓: the piggyback model IS the guest's free experience
    expect(description).toContain('🆓');
    const selectOptions = payload.components
      .flatMap(row => row.components)
      .flatMap(c => c.data.options ?? []);
    const airOption = selectOptions.find(o => o.description?.includes('glm-4.5-air'));
    expect(airOption?.description ?? '').not.toContain('requires API key');
  });

  it('does NOT badge the piggyback preset 🆓 for key-holders (billed on their key)', async () => {
    configurePresets(
      stub,
      [
        {
          id: '00000000-0000-4000-8000-00000000000b',
          name: 'GLM Air',
          model: 'z-ai/glm-4.5-air',
          provider: 'openrouter',
          isGlobal: true,
          isDefault: false,
          isOwned: false,
        },
      ],
      true // wallet present = key-holder
    );

    await handleBrowse(createMockContext());

    const payload = mockEditReply.mock.calls[0][0] as {
      embeds: { data: { description?: string } }[];
    };
    expect(payload.embeds[0].data.description ?? '').not.toContain('🆓');
  });

  it("includes the piggyback preset in a guest's 'free' scope filter", async () => {
    configurePresets(
      stub,
      [
        {
          id: '00000000-0000-4000-8000-00000000000c',
          name: 'GLM Air',
          model: 'z-ai/glm-4.5-air',
          provider: 'openrouter',
          isGlobal: true,
          isDefault: false,
          isOwned: false,
        },
        {
          id: '00000000-0000-4000-8000-00000000000d',
          name: 'Claude Paid',
          model: 'anthropic/claude-sonnet-4',
          provider: 'openrouter',
          isGlobal: true,
          isDefault: false,
          isOwned: false,
        },
      ],
      false // guest
    );

    await handleBrowse(createMockContext(null, 'free'));

    const description =
      (mockEditReply.mock.calls[0][0] as { embeds: { data: { description?: string } }[] }).embeds[0]
        .data.description ?? '';
    expect(description).toContain('GLM Air');
    expect(description).not.toContain('Claude Paid');
  });

  it('should browse presets with default settings (no filter, no query)', async () => {
    configurePresets(stub, [
      {
        id: '00000000-0000-4000-8000-000000000001',
        name: 'Default',
        model: 'anthropic/claude-sonnet-4',
        provider: 'openrouter',
        isGlobal: true,
        isDefault: true,
        isOwned: false,
      },
      {
        id: '00000000-0000-4000-8000-000000000002',
        name: 'MyPreset',
        model: 'anthropic/claude-opus-4',
        provider: 'openrouter',
        isGlobal: false,
        isDefault: false,
        isOwned: true,
      },
    ]);

    const context = createMockContext();
    await handleBrowse(context);

    expect(stub.listUserLlmConfigs).toHaveBeenCalled();
    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          data: expect.objectContaining({
            title: '⚙️ Presets',
          }),
        }),
      ],
      components: expect.any(Array), // Select menu for choosing preset
    });

    const components = mockEditReply.mock.calls[0][0].components;
    // Select menu + the always-rendered button row (pagination disabled at
    // one page; the two filter toggles live there).
    expect(components).toHaveLength(2);
    expect(components[0].components[0].data.custom_id).toBe('preset::browse-select::0::all.all::');
    const buttons = components[1].toJSON().components as { custom_id: string; label?: string }[];
    // The two-dimensional in-place filter: per-axis cycle toggles, each
    // holding the other axis constant, page reset to 0.
    const scopeToggle = buttons.find(button => button.label === 'Scope: Global');
    const capabilityToggle = buttons.find(button => button.label === 'Type: Text');
    expect(scopeToggle?.custom_id).toBe('preset::browse::0::global.all::');
    expect(capabilityToggle?.custom_id).toBe('preset::browse::0::all.text::');
  });

  it('shows both kinds by default (vision badged) and filters by capability', async () => {
    configurePresets(
      stub,
      [
        {
          id: '00000000-0000-4000-8000-000000000001',
          name: 'TextPreset',
          model: 'anthropic/claude-sonnet-4',
          provider: 'openrouter',
          isGlobal: true,
          isOwned: false,
        },
      ],
      true,
      [
        {
          id: '00000000-0000-4000-8000-000000000002',
          name: 'VisionPreset',
          model: 'openai/gpt-4o',
          provider: 'openrouter',
          isGlobal: false,
          isOwned: true,
        },
      ]
    );

    // Default kind (all): both kinds visible, vision badged with 👁️.
    await handleBrowse(createMockContext());
    const allDesc = mockEditReply.mock.calls[0][0].embeds[0].data.description;
    expect(allDesc).toContain('TextPreset');
    expect(allDesc).toContain('VisionPreset');
    expect(allDesc).toContain('👁️');

    // capability:vision → only the vision preset (filtered client-side off supportsVision).
    await handleBrowse(createMockContext(null, null, 'vision'));
    const visionDesc = mockEditReply.mock.calls[1][0].embeds[0].data.description;
    expect(visionDesc).toContain('VisionPreset');
    expect(visionDesc).not.toContain('TextPreset');

    // capability:text → only the text preset (text-only models, supportsVision=false).
    await handleBrowse(createMockContext(null, null, 'text'));
    const textDesc = mockEditReply.mock.calls[2][0].embeds[0].data.description;
    expect(textDesc).toContain('TextPreset');
    expect(textDesc).not.toContain('VisionPreset');
  });

  it('should filter by global presets', async () => {
    configurePresets(stub, [
      {
        id: '00000000-0000-4000-8000-000000000001',
        name: 'Default',
        model: 'anthropic/claude-sonnet-4',
        provider: 'openrouter',
        isGlobal: true,
        isOwned: false,
      },
      {
        id: '00000000-0000-4000-8000-000000000002',
        name: 'MyPreset',
        model: 'anthropic/claude-opus-4',
        provider: 'openrouter',
        isGlobal: false,
        isOwned: true,
      },
    ]);

    const context = createMockContext(null, 'global');
    await handleBrowse(context);

    const embedData = mockEditReply.mock.calls[0][0].embeds[0].data;
    expect(embedData.description).toContain('Default');
    expect(embedData.description).not.toContain('MyPreset');
  });

  it('should filter by owned presets', async () => {
    configurePresets(stub, [
      {
        id: '00000000-0000-4000-8000-000000000001',
        name: 'Default',
        model: 'anthropic/claude-sonnet-4',
        provider: 'openrouter',
        isGlobal: true,
        isOwned: false,
      },
      {
        id: '00000000-0000-4000-8000-000000000002',
        name: 'MyPreset',
        model: 'anthropic/claude-opus-4',
        provider: 'openrouter',
        isGlobal: false,
        isOwned: true,
      },
    ]);

    const context = createMockContext(null, 'mine');
    await handleBrowse(context);

    const embedData = mockEditReply.mock.calls[0][0].embeds[0].data;
    expect(embedData.description).not.toContain('Default');
    expect(embedData.description).toContain('MyPreset');
  });

  it('should filter by free presets', async () => {
    configurePresets(stub, [
      {
        id: '00000000-0000-4000-8000-000000000001',
        name: 'Paid Model',
        model: 'anthropic/claude-sonnet-4',
        provider: 'openrouter',
        isGlobal: true,
        isOwned: false,
      },
      {
        id: '00000000-0000-4000-8000-000000000002',
        name: 'Free Model',
        model: 'x-ai/grok-4.1-fast:free',
        provider: 'openrouter',
        isGlobal: true,
        isOwned: false,
      },
    ]);

    const context = createMockContext(null, 'free');
    await handleBrowse(context);

    const embedData = mockEditReply.mock.calls[0][0].embeds[0].data;
    expect(embedData.description).not.toContain('Paid Model');
    expect(embedData.description).toContain('Free Model');
  });

  it('should search by query', async () => {
    configurePresets(stub, [
      {
        id: '00000000-0000-4000-8000-000000000001',
        name: 'Claude Default',
        model: 'anthropic/claude-sonnet-4',
        provider: 'openrouter',
        isGlobal: true,
        isOwned: false,
      },
      {
        id: '00000000-0000-4000-8000-000000000002',
        name: 'GPT Config',
        model: 'openai/gpt-4o',
        provider: 'openrouter',
        isGlobal: true,
        isOwned: false,
      },
    ]);

    const context = createMockContext('claude', null);
    await handleBrowse(context);

    const embedData = mockEditReply.mock.calls[0][0].embeds[0].data;
    expect(embedData.description).toContain('Claude Default');
    expect(embedData.description).not.toContain('GPT Config');
    expect(embedData.description).toContain('Searching: "claude"');
  });

  it('should show guest mode warning when no active wallet', async () => {
    configurePresets(
      stub,
      [
        {
          id: '00000000-0000-4000-8000-000000000001',
          name: 'Default',
          model: 'anthropic/claude-sonnet-4',
          provider: 'openrouter',
          isGlobal: true,
          isOwned: false,
        },
      ],
      false
    );

    const context = createMockContext();
    await handleBrowse(context);

    const embedData = mockEditReply.mock.calls[0][0].embeds[0].data;
    expect(embedData.description).toContain('Guest Mode');
  });

  it('should show no results message when filter produces empty results', async () => {
    configurePresets(stub, [
      {
        id: '00000000-0000-4000-8000-000000000001',
        name: 'Global Only',
        model: 'anthropic/claude-sonnet-4',
        provider: 'openrouter',
        isGlobal: true,
        isOwned: false,
      },
    ]);

    const context = createMockContext(null, 'mine');
    await handleBrowse(context);

    const embedData = mockEditReply.mock.calls[0][0].embeds[0].data;
    expect(embedData.description).toContain(
      'No presets match — clear the search or filter to see all.'
    );
  });

  it('should handle API error', async () => {
    stub.listUserLlmConfigs.mockResolvedValue(makeErr(500, 'Server error'));
    stub.listWalletKeys.mockResolvedValue(makeErr(500, 'Server error'));

    const context = createMockContext();
    await handleBrowse(context);

    expect(mockEditReply).toHaveBeenCalledWith({
      content: "⚠️ Couldn't load your presets right now. Please try again later.",
    });
  });

  it('should handle exceptions', async () => {
    stub.listUserLlmConfigs.mockRejectedValue(new Error('Network error'));
    stub.listWalletKeys.mockRejectedValue(new Error('Network error'));

    const context = createMockContext();
    await handleBrowse(context);

    expect(mockEditReply).toHaveBeenCalledWith({
      content: '❌ Failed to load the presets. Please try again.',
    });
  });
});

describe('handleBrowsePagination', () => {
  const mockDeferUpdate = vi.fn();
  const mockEditReply = vi.fn();
  const mockFollowUp = vi.fn();
  let stub: UserClientStub;

  beforeEach(() => {
    vi.clearAllMocks();
    stub = createStub();
    clientsForMock.mockReturnValue({ userClient: asUserClient(stub) });
    // followUp must return a promise — the handler chains `.catch` on it.
    mockFollowUp.mockResolvedValue(undefined);
  });

  function createMockButtonInteraction(customId: string) {
    return {
      customId,
      user: { id: '123456789', username: 'testuser' },
      deferUpdate: mockDeferUpdate,
      editReply: mockEditReply,
      followUp: mockFollowUp,
    } as unknown as ButtonInteraction;
  }

  it('acks first, then returns without fetching for an unparseable custom ID', async () => {
    const mockInteraction = createMockButtonInteraction('invalid::custom::id');
    await handleBrowsePagination(mockInteraction);

    // Ack-first: deferUpdate runs before the parse guard so the interaction is
    // always acknowledged within Discord's 3s window — no fetch on a bad id.
    expect(mockDeferUpdate).toHaveBeenCalled();
    expect(stub.listUserLlmConfigs).not.toHaveBeenCalled();
  });

  it('acks a stale pre-deploy bare-scope customId instead of failing the interaction', async () => {
    // Regression guard: before the format change, buttons encoded `::all::`; the
    // new parse only accepts composites like `::all.all::`. The handler must
    // still ack (deferUpdate) so the user never sees "This interaction failed".
    const mockInteraction = createMockButtonInteraction('preset::browse::0::all::');
    await handleBrowsePagination(mockInteraction);

    expect(mockDeferUpdate).toHaveBeenCalled();
    expect(stub.listUserLlmConfigs).not.toHaveBeenCalled();
  });

  it('should defer update on pagination', async () => {
    configurePresets(stub, [
      {
        id: '00000000-0000-4000-8000-000000000001',
        name: 'Default',
        model: 'anthropic/claude-sonnet-4',
        provider: 'openrouter',
        isGlobal: true,
      },
    ]);

    const mockInteraction = createMockButtonInteraction('preset::browse::1::all.all::');
    await handleBrowsePagination(mockInteraction);

    expect(mockDeferUpdate).toHaveBeenCalled();
  });

  it('should refresh data and update reply', async () => {
    configurePresets(stub, [
      {
        id: '00000000-0000-4000-8000-000000000001',
        name: 'Default',
        model: 'anthropic/claude-sonnet-4',
        provider: 'openrouter',
        isGlobal: true,
      },
    ]);

    const mockInteraction = createMockButtonInteraction('preset::browse::0::all.all::');
    await handleBrowsePagination(mockInteraction);

    expect(stub.listUserLlmConfigs).toHaveBeenCalled();
    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: expect.any(Array),
      components: expect.any(Array),
    });
  });

  it('should apply filter from custom ID', async () => {
    configurePresets(stub, [
      {
        id: '00000000-0000-4000-8000-000000000001',
        name: 'Global',
        model: 'anthropic/claude-sonnet-4',
        provider: 'openrouter',
        isGlobal: true,
        isOwned: false,
      },
      {
        id: '00000000-0000-4000-8000-000000000002',
        name: 'Mine',
        model: 'anthropic/claude-opus-4',
        provider: 'openrouter',
        isGlobal: false,
        isOwned: true,
      },
    ]);

    const mockInteraction = createMockButtonInteraction('preset::browse::0::mine.all::');
    await handleBrowsePagination(mockInteraction);

    const embedData = mockEditReply.mock.calls[0][0].embeds[0].data;
    expect(embedData.description).toContain('Mine');
    expect(embedData.description).not.toContain('Global');
  });

  it('should apply query from custom ID', async () => {
    configurePresets(stub, [
      {
        id: '00000000-0000-4000-8000-000000000001',
        name: 'Claude Config',
        model: 'anthropic/claude-sonnet-4',
        provider: 'openrouter',
        isGlobal: true,
      },
      {
        id: '00000000-0000-4000-8000-000000000002',
        name: 'GPT Config',
        model: 'openai/gpt-4o',
        provider: 'openrouter',
        isGlobal: true,
      },
    ]);

    const mockInteraction = createMockButtonInteraction('preset::browse::0::all.all::claude');
    await handleBrowsePagination(mockInteraction);

    const embedData = mockEditReply.mock.calls[0][0].embeds[0].data;
    expect(embedData.description).toContain('Claude Config');
    expect(embedData.description).not.toContain('GPT Config');
  });

  it('surfaces an ephemeral followUp when a page fails to load (view preserved)', async () => {
    stub.listUserLlmConfigs.mockResolvedValue(makeErr(500, 'Server error'));
    stub.listWalletKeys.mockResolvedValue(makeErr(500, 'Server error'));

    const mockInteraction = createMockButtonInteraction('preset::browse::1::all.all::');
    await handleBrowsePagination(mockInteraction);

    expect(mockDeferUpdate).toHaveBeenCalled();
    // The prior view stays put (no editReply), but the user gets a nudge.
    expect(mockEditReply).not.toHaveBeenCalled();
    expect(mockFollowUp).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("Couldn't load that page") })
    );
  });

  it('surfaces an ephemeral followUp on exception (no throw, view preserved)', async () => {
    stub.listUserLlmConfigs.mockRejectedValue(new Error('Network error'));
    stub.listWalletKeys.mockRejectedValue(new Error('Network error'));

    const mockInteraction = createMockButtonInteraction('preset::browse::1::all.all::');

    await expect(handleBrowsePagination(mockInteraction)).resolves.not.toThrow();
    expect(mockEditReply).not.toHaveBeenCalled();
    expect(mockFollowUp).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("Couldn't load that page") })
    );
  });

  it('stays non-throwing when the followUp nudge itself throws (expired token)', async () => {
    // Simulates Discord 10062 Unknown Interaction on the nudge: the handler must
    // still resolve, not propagate — the followUp `.catch` swallows + logs it.
    stub.listUserLlmConfigs.mockResolvedValue(makeErr(500, 'Server error'));
    stub.listWalletKeys.mockResolvedValue(makeErr(500, 'Server error'));
    mockFollowUp.mockRejectedValue(new Error('Unknown interaction'));

    const mockInteraction = createMockButtonInteraction('preset::browse::1::all.all::');

    await expect(handleBrowsePagination(mockInteraction)).resolves.not.toThrow();
    expect(mockFollowUp).toHaveBeenCalled();
  });
});

describe('isPresetBrowseInteraction', () => {
  it('should return true for browse custom IDs', () => {
    expect(isPresetBrowseInteraction('preset::browse::0::all::')).toBe(true);
  });

  it('should return false for non-browse custom IDs', () => {
    expect(isPresetBrowseInteraction('preset::menu::123')).toBe(false);
  });
});

describe('isPresetBrowseSelectInteraction', () => {
  it('should return true for browse-select custom ID', () => {
    expect(isPresetBrowseSelectInteraction('preset::browse-select')).toBe(true);
  });

  it('should return false for browse pagination custom IDs', () => {
    expect(isPresetBrowseSelectInteraction('preset::browse::0::all::')).toBe(false);
  });

  it('should return false for other custom IDs', () => {
    expect(isPresetBrowseSelectInteraction('preset::menu::123')).toBe(false);
  });
});

describe('handleBrowseSelect', () => {
  const mockDeferUpdate = vi.fn();
  const mockEditReply = vi.fn();
  let stub: UserClientStub;

  beforeEach(() => {
    vi.clearAllMocks();
    stub = createStub();
    clientsForMock.mockReturnValue({ userClient: asUserClient(stub) });
  });

  function createMockSelectInteraction(presetId: string) {
    return {
      customId: 'preset::browse-select',
      values: [presetId],
      user: { id: '123456789', username: 'testuser' },
      deferUpdate: mockDeferUpdate,
      editReply: mockEditReply,
      message: { id: 'message-123' },
      channelId: 'channel-123',
    } as unknown as StringSelectMenuInteraction;
  }

  it('should open dashboard for selected preset', async () => {
    mockFetchPreset.mockResolvedValue({
      id: 'preset-123',
      name: 'Test Preset',
      model: 'anthropic/claude-sonnet-4',
      provider: 'openrouter',
      isOwned: true,
      isGlobal: false,
    });

    const mockInteraction = createMockSelectInteraction('preset-123');
    await handleBrowseSelect(mockInteraction);

    expect(mockDeferUpdate).toHaveBeenCalled();
    expect(mockFetchPreset).toHaveBeenCalledWith('preset-123', expect.anything());
    expect(mockBuildDashboardEmbed).toHaveBeenCalled();
    expect(mockBuildDashboardComponents).toHaveBeenCalled();
    expect(mockEditReply).toHaveBeenCalled();
    expect(mockSessionManagerSet).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: '123456789',
        entityType: 'preset',
        entityId: 'preset-123',
      })
    );
  });

  it('should handle preset not found', async () => {
    mockFetchPreset.mockResolvedValue(null);

    const mockInteraction = createMockSelectInteraction('nonexistent');
    await handleBrowseSelect(mockInteraction);

    expect(mockDeferUpdate).toHaveBeenCalled();
    expect(mockEditReply).toHaveBeenCalledWith({
      content: '❌ Preset not found.',
      embeds: [],
      components: [],
    });
  });

  it('should handle fetch errors', async () => {
    mockFetchPreset.mockRejectedValue(new Error('Network error'));

    const mockInteraction = createMockSelectInteraction('preset-123');
    await handleBrowseSelect(mockInteraction);

    expect(mockDeferUpdate).toHaveBeenCalled();
    expect(mockEditReply).toHaveBeenCalledWith({
      content: '❌ Failed to load the preset. Please try again.',
      embeds: [],
      components: [],
    });
  });
});

// Capture the rebuilder callback registered at module-load BEFORE any
// `vi.clearAllMocks()` wipes the call history.
const presetRebuilderCall = vi
  .mocked(registerBrowseRebuilder)
  .mock.calls.find(c => c[0] === 'preset');
if (presetRebuilderCall === undefined) {
  throw new Error('preset rebuilder was not registered at module load');
}
const presetRebuilder = presetRebuilderCall[1];

describe('registered browse rebuilder', () => {
  let stub: UserClientStub;

  beforeEach(() => {
    vi.clearAllMocks();
    stub = createStub();
    clientsForMock.mockReturnValue({ userClient: asUserClient(stub) });
  });

  function createMockInteraction() {
    return { user: { id: '123456789', username: 'testuser' } } as unknown as Parameters<
      typeof presetRebuilder
    >[0];
  }

  it('returns rebuilt view with banner on success', async () => {
    configurePresets(stub, [
      {
        id: '00000000-0000-4000-8000-000000000001',
        name: 'Default',
        model: 'anthropic/claude-sonnet-4',
        provider: 'openrouter',
        isGlobal: true,
        isOwned: false,
      },
    ]);

    const result = await presetRebuilder(
      createMockInteraction(),
      { source: 'browse', page: 0, filter: 'all.all', query: null },
      '✅ Banner'
    );

    expect(result).not.toBeNull();
    expect(result).toEqual({
      content: '✅ Banner',
      embeds: expect.any(Array),
      components: expect.any(Array),
    });
  });

  it('returns null when gateway fetch fails', async () => {
    stub.listUserLlmConfigs.mockResolvedValue(makeErr(500, 'Server error'));
    stub.listWalletKeys.mockResolvedValue(makeErr(500, 'Server error'));

    const result = await presetRebuilder(
      createMockInteraction(),
      { source: 'browse', page: 0, filter: 'all.all', query: null },
      '✅ Banner'
    );

    expect(result).toBeNull();
  });
});
