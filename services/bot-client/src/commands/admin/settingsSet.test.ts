import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AUTO_ROUTER_MODEL, FREE_ROUTER_MODEL } from '@tzurot/common-types/constants/ai';
import type { AutocompleteInteraction } from 'discord.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';

const mockGetSystemSettings = vi.fn();
const mockUpdateSystemSettings = vi.fn();
const mockFetchTextModels = vi.fn();
const mockFetchVisionModels = vi.fn();

vi.mock('../../utils/gatewayClients.js', () => ({
  clientsFor: () => ({
    ownerClient: {
      getSystemSettings: mockGetSystemSettings,
      updateSystemSettings: mockUpdateSystemSettings,
    },
  }),
}));

vi.mock('../../utils/modelAutocomplete.js', () => ({
  fetchTextModels: (search?: string) => mockFetchTextModels(search),
  fetchVisionModels: (search?: string) => mockFetchVisionModels(search),
  formatModelChoice: (model: { name: string; id: string }) => ({
    name: model.name,
    value: model.id,
  }),
}));

import {
  handleSettingsSet,
  handleSettingNameAutocomplete,
  handleSettingValueAutocomplete,
} from './settingsSet.js';

const UPDATED_AT = '2026-07-12T10:00:00.000Z';

function makeContext(
  setting: string,
  value: string
): DeferredCommandContext & {
  editReply: ReturnType<typeof vi.fn>;
} {
  const options = {
    getString: vi.fn((name: string) => (name === 'setting' ? setting : value)),
  };
  return {
    interaction: { options, user: { id: 'owner-1' } },
    editReply: vi.fn().mockResolvedValue(undefined),
  } as unknown as DeferredCommandContext & { editReply: ReturnType<typeof vi.fn> };
}

function makeAutocomplete(selectedSetting: string | null): AutocompleteInteraction & {
  respond: ReturnType<typeof vi.fn>;
} {
  return {
    options: { getString: vi.fn(() => selectedSetting) },
    respond: vi.fn().mockResolvedValue(undefined),
  } as unknown as AutocompleteInteraction & { respond: ReturnType<typeof vi.fn> };
}

describe('handleSettingsSet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSystemSettings.mockResolvedValue({
      ok: true,
      data: { systemSettings: { zaiHeadroomPercent: 75 }, updatedAt: UPDATED_AT },
    });
    mockUpdateSystemSettings.mockResolvedValue({
      ok: true,
      data: { systemSettings: {}, updatedAt: UPDATED_AT, warnings: [] },
    });
  });

  it('sends the coerced patch with the concurrency token from the read', async () => {
    const context = makeContext('zaiHeadroomPercent', '50');

    await handleSettingsSet(context);

    expect(mockUpdateSystemSettings).toHaveBeenCalledWith({
      expectedUpdatedAt: UPDATED_AT,
      patch: { zaiHeadroomPercent: 50 },
    });
    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('✅'),
    });
  });

  it('shows the old value in the success message', async () => {
    const context = makeContext('zaiHeadroomPercent', '50');

    await handleSettingsSet(context);

    const content = (context.editReply.mock.calls[0][0] as { content: string }).content;
    expect(content).toContain('75');
    expect(content).toContain('50');
  });

  it('coerces booleans and rejects non-boolean input client-side', async () => {
    const good = makeContext('extractionEnabled', 'TRUE');
    await handleSettingsSet(good);
    expect(mockUpdateSystemSettings).toHaveBeenCalledWith(
      expect.objectContaining({ patch: { extractionEnabled: true } })
    );

    const bad = makeContext('extractionEnabled', 'yes');
    await handleSettingsSet(bad);
    const content = (bad.editReply.mock.calls[0][0] as { content: string }).content;
    expect(content).toContain('❌');
    expect(mockUpdateSystemSettings).toHaveBeenCalledTimes(1);
  });

  it('rejects a non-integer for integer controls without calling the gateway', async () => {
    const context = makeContext('freeTierMaxPerWindow', 'lots');

    await handleSettingsSet(context);

    expect(mockUpdateSystemSettings).not.toHaveBeenCalled();
  });

  it('rejects an unknown enum choice client-side', async () => {
    const context = makeContext('extractionProvider', 'bedrock');

    await handleSettingsSet(context);

    expect(mockUpdateSystemSettings).not.toHaveBeenCalled();
  });

  it('rejects an unknown setting', async () => {
    const context = makeContext('notARealSetting', 'x');

    await handleSettingsSet(context);

    expect(mockGetSystemSettings).not.toHaveBeenCalled();
    expect(mockUpdateSystemSettings).not.toHaveBeenCalled();
  });

  it('surfaces the gateway validation error verbatim', async () => {
    mockUpdateSystemSettings.mockResolvedValue({
      ok: false,
      status: 400,
      error: 'fallbackTextModelFree accepts only free-route models',
    });
    const context = makeContext('fallbackTextModelFree', 'anthropic/claude-haiku-4.5');

    await handleSettingsSet(context);

    const content = (context.editReply.mock.calls[0][0] as { content: string }).content;
    expect(content).toContain('free-route');
  });

  it('adds a retry hint on a 409 concurrency conflict', async () => {
    mockUpdateSystemSettings.mockResolvedValue({
      ok: false,
      status: 409,
      error: 'Settings changed underneath you — refresh and retry',
    });
    const context = makeContext('zaiHeadroomPercent', '50');

    await handleSettingsSet(context);

    const content = (context.editReply.mock.calls[0][0] as { content: string }).content;
    expect(content).toContain('re-run the command');
  });

  it('renders gateway warnings on success', async () => {
    mockUpdateSystemSettings.mockResolvedValue({
      ok: true,
      data: {
        systemSettings: {},
        updatedAt: UPDATED_AT,
        warnings: ['extractionModel: could not be verified against the model catalog'],
      },
    });
    const context = makeContext('extractionModel', 'brand-new/model');

    await handleSettingsSet(context);

    const content = (context.editReply.mock.calls[0][0] as { content: string }).content;
    expect(content).toContain('⚠️');
  });

  it('stops with an error when the settings read fails', async () => {
    mockGetSystemSettings.mockResolvedValue({ ok: false, error: 'gateway unreachable' });
    const context = makeContext('zaiHeadroomPercent', '50');

    await handleSettingsSet(context);

    expect(mockUpdateSystemSettings).not.toHaveBeenCalled();
    const content = (context.editReply.mock.calls[0][0] as { content: string }).content;
    expect(content).toContain('gateway unreachable');
  });
});

describe('handleSettingNameAutocomplete', () => {
  it('filters registry keys by query against key and label', async () => {
    const interaction = makeAutocomplete(null);

    await handleSettingNameAutocomplete(interaction, 'fallback');

    const choices = interaction.respond.mock.calls[0][0] as { name: string; value: string }[];
    expect(choices.map(c => c.value)).toEqual(
      expect.arrayContaining(['fallbackTextModel', 'fallbackVisionModelFree'])
    );
    expect(choices.every(c => c.value.toLowerCase().includes('fallback'))).toBe(true);
  });

  it('returns all keys (≤25) on an empty query', async () => {
    const interaction = makeAutocomplete(null);

    await handleSettingNameAutocomplete(interaction, '');

    const choices = interaction.respond.mock.calls[0][0] as unknown[];
    expect(choices.length).toBeGreaterThan(10);
    expect(choices.length).toBeLessThanOrEqual(25);
  });
});

describe('handleSettingValueAutocomplete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchTextModels.mockResolvedValue([]);
    mockFetchVisionModels.mockResolvedValue([]);
  });

  it('offers true/false for boolean settings', async () => {
    const interaction = makeAutocomplete('extractionEnabled');

    await handleSettingValueAutocomplete(interaction, '');

    expect(interaction.respond).toHaveBeenCalledWith([
      { name: 'true', value: 'true' },
      { name: 'false', value: 'false' },
    ]);
  });

  it('offers the enum choices for extractionProvider', async () => {
    const interaction = makeAutocomplete('extractionProvider');

    await handleSettingValueAutocomplete(interaction, '');

    expect(interaction.respond).toHaveBeenCalledWith([
      { name: 'openrouter', value: 'openrouter' },
      { name: 'zai-coding', value: 'zai-coding' },
    ]);
  });

  it('offers vision-catalog models plus aliases for the vision floor', async () => {
    mockFetchVisionModels.mockResolvedValue([{ name: 'Qwen Vision', id: 'qwen/vision' }]);
    const interaction = makeAutocomplete('fallbackVisionModel');

    await handleSettingValueAutocomplete(interaction, '');

    expect(mockFetchVisionModels).toHaveBeenCalled();
    expect(mockFetchTextModels).not.toHaveBeenCalled();
    const choices = interaction.respond.mock.calls[0][0] as { value: string }[];
    expect(choices.map(c => c.value)).toEqual(
      expect.arrayContaining([AUTO_ROUTER_MODEL, FREE_ROUTER_MODEL, 'qwen/vision'])
    );
  });

  it('offers text-catalog models for the free text floor with its alias first', async () => {
    mockFetchTextModels.mockResolvedValue([{ name: 'Some Model', id: 'some/model' }]);
    const interaction = makeAutocomplete('fallbackTextModelFree');

    await handleSettingValueAutocomplete(interaction, '');

    const choices = interaction.respond.mock.calls[0][0] as { value: string }[];
    expect(choices[0].value).toBe(FREE_ROUTER_MODEL);
  });

  it('responds empty for integer settings (free text)', async () => {
    const interaction = makeAutocomplete('zaiHeadroomPercent');

    await handleSettingValueAutocomplete(interaction, '');

    expect(interaction.respond).toHaveBeenCalledWith([]);
  });

  it('responds empty when no setting has been picked yet', async () => {
    const interaction = makeAutocomplete(null);

    await handleSettingValueAutocomplete(interaction, '');

    expect(interaction.respond).toHaveBeenCalledWith([]);
  });
});
