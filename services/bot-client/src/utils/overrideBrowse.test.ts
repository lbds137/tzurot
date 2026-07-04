/**
 * Tests for the shared per-character override browser (select → clear).
 *
 * Covers the customId helpers, the view builder, and the three interaction
 * handlers (slash / select / button). The two consumers (preset + TTS) are
 * thin wrappers, so this is where the behaviour is exercised — including the
 * optional `kind` axis (preset overrides span text + vision; TTS has none).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { type EmbedBuilder } from 'discord.js';
import type { UserClient } from '@tzurot/clients';
import type { ConfigKind } from '@tzurot/common-types/constants/ai';
import { makeOk, makeErr } from '../test/gatewayClientStubs.js';
import {
  type OverrideBrowseConfig,
  type OverrideSummary,
  createOverrideBrowseCustomIds,
  buildOverrideBrowseView,
  handleOverrideBrowse,
  handleOverrideBrowseSelect,
  handleOverrideBrowseButton,
} from './overrideBrowse.js';

const stub = {
  // list now returns `OverrideSummary[] | null` (null = fetch failed); the
  // domain config owns the fetch strategy (preset issues two kind-scoped calls).
  list: vi.fn(),
  delete: vi.fn(),
};

vi.mock('./gatewayClients.js', () => ({
  clientsFor: vi.fn(() => ({ userClient: {} as unknown as UserClient })),
}));

const PREFIX = 'test-override';

function makeConfig(): OverrideBrowseConfig {
  return {
    prefix: PREFIX,
    title: '🎭 Test Overrides',
    entityType: 'test override',
    fallbackNoun: 'default',
    emptyDescription: 'No overrides set. Use /test set.',
    clearCommandHint: '/test clear',
    selectPlaceholder: 'Pick one…',
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
    list: () => stub.list() as ReturnType<OverrideBrowseConfig['list']>,
    delete: (_uc, id, kind) => stub.delete(id, kind) as ReturnType<OverrideBrowseConfig['delete']>,
  };
}

function override(
  id: string,
  name: string,
  configName: string | null = 'Cfg',
  kind?: ConfigKind,
  supportsVision?: boolean
): OverrideSummary {
  return { personalityId: id, personalityName: name, configName, kind, supportsVision };
}

beforeEach(() => {
  vi.clearAllMocks();
  stub.list.mockReset();
  stub.delete.mockReset();
});

describe('createOverrideBrowseCustomIds', () => {
  const ids = createOverrideBrowseCustomIds(PREFIX);

  it('builds select / cancel / clear ids', () => {
    expect(ids.select).toBe('test-override::select');
    expect(ids.cancel).toBe('test-override::cancel');
    expect(ids.clear('p1')).toBe('test-override::clear::p1');
  });

  it('appends kind as a 4th segment when present', () => {
    expect(ids.clear('p1', 'vision')).toBe('test-override::clear::p1::vision');
    expect(ids.clear('p1', 'text')).toBe('test-override::clear::p1::text');
  });

  it('isOwn matches only this prefix', () => {
    expect(ids.isOwn('test-override::select')).toBe(true);
    expect(ids.isOwn('other::select')).toBe(false);
    expect(ids.isOwn('test-override-extra::select')).toBe(false);
  });

  it('parses each action', () => {
    expect(ids.parse('test-override::select')).toEqual({ action: 'select' });
    expect(ids.parse('test-override::cancel')).toEqual({ action: 'cancel' });
    expect(ids.parse('test-override::clear::p1')).toEqual({ action: 'clear', personalityId: 'p1' });
  });

  it('parses the kind segment on a clear id', () => {
    expect(ids.parse('test-override::clear::p1::vision')).toEqual({
      action: 'clear',
      personalityId: 'p1',
      kind: 'vision',
    });
    // A non-kind 4th segment is ignored (kind left undefined).
    expect(ids.parse('test-override::clear::p1::bogus')).toEqual({
      action: 'clear',
      personalityId: 'p1',
      kind: undefined,
    });
  });

  it('returns null for foreign or malformed ids', () => {
    expect(ids.parse('other::select')).toBeNull();
    expect(ids.parse('test-override::clear')).toBeNull();
    expect(ids.parse('test-override::clear::')).toBeNull();
    expect(ids.parse('test-override::bogus')).toBeNull();
  });
});

describe('buildOverrideBrowseView', () => {
  it('renders empty state with no components', () => {
    const { embeds, components } = buildOverrideBrowseView(makeConfig(), []);
    const data = embeds[0].toJSON();
    expect(data.title).toBe('🎭 Test Overrides');
    expect(data.description).toContain('No overrides set');
    expect(components).toHaveLength(0);
  });

  it('renders overrides with a select menu keyed by personalityId', () => {
    const overrides = [override('p1', 'Lilith', 'Fast Claude'), override('p2', 'Bob', 'GPT-4')];
    const { embeds, components } = buildOverrideBrowseView(makeConfig(), overrides);

    const data = embeds[0].toJSON();
    expect(data.description).toContain('Lilith');
    expect(data.description).toContain('Fast Claude');
    expect(data.footer?.text).toContain('2 override(s)');

    expect(components).toHaveLength(1);
    const row = components[0].toJSON() as {
      components: { custom_id: string; options: { label: string; value: string }[] }[];
    };
    const menu = row.components[0];
    expect(menu.custom_id).toBe('test-override::select');
    // No kind → bare personalityId values (kind-less domains unchanged).
    expect(menu.options.map(o => o.value)).toEqual(['p1', 'p2']);
    expect(menu.options[0].label).toContain('Lilith');
  });

  it('badges by model capability (supportsVision) and encodes kind in the select value', () => {
    const overrides = [
      override('p1', 'Lilith', 'Text Cfg', 'text', false),
      override('p1', 'Lilith', 'Vision Cfg', 'vision', true),
    ];
    const { embeds, components } = buildOverrideBrowseView(makeConfig(), overrides);

    // The vision-capable row carries the 👁️ badge; the non-vision row does not.
    const description = embeds[0].toJSON().description ?? '';
    expect(description).toContain('👁️');

    const row = components[0].toJSON() as {
      components: { options: { label: string; value: string }[] }[];
    };
    const menu = row.components[0];
    // Same personality, two kinds → kind-encoded values disambiguate them.
    expect(menu.options.map(o => o.value)).toEqual(['p1::text', 'p1::vision']);
    expect(menu.options[1].label).toContain('👁️');
    expect(menu.options[0].label).not.toContain('👁️');
  });

  it('badges from capability, not slot: a chat-slot override on a vision-capable model gets 👁️', () => {
    // The badge reflects the MODEL's capability, not which slot the override
    // occupies — a chat-slot (kind:text) override whose model supports vision is
    // still badged. This is the whole point of the capability-driven switch.
    const overrides = [override('p1', 'Lilith', 'Vision-capable chat model', 'text', true)];
    const { embeds, components } = buildOverrideBrowseView(makeConfig(), overrides);

    expect(embeds[0].toJSON().description ?? '').toContain('👁️');
    const row = components[0].toJSON() as { components: { options: { label: string }[] }[] };
    expect(row.components[0].options[0].label).toContain('👁️');
  });

  it('renders Unknown for a null config name', () => {
    const { embeds } = buildOverrideBrowseView(makeConfig(), [override('p1', 'Test', null)]);
    expect(embeds[0].toJSON().description).toContain('Unknown');
  });

  it('caps the select menu at 25 and notes truncation in the footer', () => {
    const overrides = Array.from({ length: 30 }, (_, i) => override(`p${i}`, `Name${i}`));
    const { embeds, components } = buildOverrideBrowseView(makeConfig(), overrides);

    const row = components[0].toJSON() as { components: { options: unknown[] }[] };
    expect(row.components[0].options).toHaveLength(25);

    const footer = embeds[0].toJSON().footer?.text ?? '';
    expect(footer).toContain('first 25 shown');
    expect(footer).toContain('/test clear');
  });
});

describe('handleOverrideBrowse', () => {
  const editReply = vi.fn();
  const context = {
    user: { id: 'u1' },
    interaction: {} as never,
    editReply,
  } as unknown as Parameters<typeof handleOverrideBrowse>[1];

  it('renders the browse view on success', async () => {
    stub.list.mockResolvedValue([override('p1', 'Lilith')]);
    await handleOverrideBrowse(makeConfig(), context);

    const arg = editReply.mock.calls[0][0] as { embeds: EmbedBuilder[] };
    expect(arg.embeds[0].toJSON().description).toContain('Lilith');
  });

  it('shows an error when the list call fails (null)', async () => {
    stub.list.mockResolvedValue(null);
    await handleOverrideBrowse(makeConfig(), context);
    expect(editReply).toHaveBeenCalledWith({
      content: '❌ Failed to load overrides. Please try again later.',
    });
  });

  it('shows a generic error when the list call throws', async () => {
    stub.list.mockRejectedValue(new Error('network'));
    await handleOverrideBrowse(makeConfig(), context);
    expect(editReply).toHaveBeenCalledWith({
      content: '❌ An error occurred. Please try again later.',
    });
  });
});

describe('handleOverrideBrowseSelect', () => {
  const deferUpdate = vi.fn();
  const editReply = vi.fn();
  function selectInteraction(value: string) {
    return {
      values: [value],
      user: { id: 'u1' },
      deferUpdate,
      editReply,
    } as unknown as Parameters<typeof handleOverrideBrowseSelect>[1];
  }

  it('shows a clear-confirmation for the chosen override', async () => {
    stub.list.mockResolvedValue([override('p1', 'Lilith')]);
    await handleOverrideBrowseSelect(makeConfig(), selectInteraction('p1'));

    expect(deferUpdate).toHaveBeenCalled();
    const arg = editReply.mock.calls[0][0] as {
      embeds: EmbedBuilder[];
      components: { toJSON: () => { components: { custom_id: string }[] } }[];
    };
    expect(arg.embeds[0].toJSON().title).toContain('Clear test override?');
    expect(arg.embeds[0].toJSON().description).toContain('Lilith');
    const buttonIds = arg.components[0].toJSON().components.map(c => c.custom_id);
    expect(buttonIds).toEqual(['test-override::cancel', 'test-override::clear::p1']);
  });

  it('disambiguates a kind-encoded select value and carries kind into the clear id', async () => {
    stub.list.mockResolvedValue([
      override('p1', 'Lilith', 'Text Cfg', 'text'),
      override('p1', 'Lilith', 'Vision Cfg', 'vision'),
    ]);
    await handleOverrideBrowseSelect(makeConfig(), selectInteraction('p1::vision'));

    const arg = editReply.mock.calls[0][0] as {
      components: { toJSON: () => { components: { custom_id: string }[] } }[];
    };
    const buttonIds = arg.components[0].toJSON().components.map(c => c.custom_id);
    expect(buttonIds).toEqual(['test-override::cancel', 'test-override::clear::p1::vision']);
  });

  it('refreshes the list if the override was already cleared', async () => {
    stub.list.mockResolvedValue([]);
    await handleOverrideBrowseSelect(makeConfig(), selectInteraction('gone'));

    const arg = editReply.mock.calls[0][0] as { embeds: EmbedBuilder[] };
    expect(arg.embeds[0].toJSON().description).toContain('No overrides set');
  });

  it('shows an error (clearing stale view) when the list call fails', async () => {
    stub.list.mockResolvedValue(null);
    await handleOverrideBrowseSelect(makeConfig(), selectInteraction('p1'));
    expect(editReply).toHaveBeenCalledWith({
      content: '❌ Failed to load overrides. Please try again later.',
      embeds: [],
      components: [],
    });
  });

  it('shows a generic error (clearing stale view) when the list call throws after deferring', async () => {
    stub.list.mockRejectedValue(new Error('network'));
    await handleOverrideBrowseSelect(makeConfig(), selectInteraction('p1'));
    expect(deferUpdate).toHaveBeenCalled();
    expect(editReply).toHaveBeenCalledWith({
      content: '❌ An error occurred. Please try again later.',
      embeds: [],
      components: [],
    });
  });
});

describe('handleOverrideBrowseButton', () => {
  const deferUpdate = vi.fn();
  const editReply = vi.fn();
  function buttonInteraction(customId: string) {
    return {
      customId,
      user: { id: 'u1' },
      deferUpdate,
      editReply,
    } as unknown as Parameters<typeof handleOverrideBrowseButton>[1];
  }

  it('clears the override and refreshes on confirm', async () => {
    stub.delete.mockResolvedValue(makeOk({ deleted: true }));
    stub.list.mockResolvedValue([]);

    await handleOverrideBrowseButton(makeConfig(), buttonInteraction('test-override::clear::p1'));

    expect(deferUpdate).toHaveBeenCalled();
    // No kind in the customId → kind passed through as undefined.
    expect(stub.delete).toHaveBeenCalledWith('p1', undefined);
    const arg = editReply.mock.calls[0][0] as { embeds: EmbedBuilder[] };
    expect(arg.embeds[0].toJSON().description).toContain('No overrides set');
  });

  it('passes the kind through to delete when the clear id carries it', async () => {
    stub.delete.mockResolvedValue(makeOk({ deleted: true }));
    stub.list.mockResolvedValue([]);

    await handleOverrideBrowseButton(
      makeConfig(),
      buttonInteraction('test-override::clear::p1::vision')
    );

    expect(stub.delete).toHaveBeenCalledWith('p1', 'vision');
  });

  it('refreshes without deleting on cancel', async () => {
    stub.list.mockResolvedValue([override('p1', 'Lilith')]);

    await handleOverrideBrowseButton(makeConfig(), buttonInteraction('test-override::cancel'));

    expect(stub.delete).not.toHaveBeenCalled();
    const arg = editReply.mock.calls[0][0] as { embeds: EmbedBuilder[] };
    expect(arg.embeds[0].toJSON().description).toContain('Lilith');
  });

  it('shows an error when the delete call fails', async () => {
    stub.delete.mockResolvedValue(makeErr(500));

    await handleOverrideBrowseButton(makeConfig(), buttonInteraction('test-override::clear::p1'));

    expect(editReply).toHaveBeenCalledWith({
      content: '❌ Failed to clear the override. Please try again later.',
      embeds: [],
      components: [],
    });
    expect(stub.list).not.toHaveBeenCalled();
  });

  it('shows the load error (clearing stale view) when delete succeeds but the refresh fails', async () => {
    stub.delete.mockResolvedValue(makeOk({ deleted: true }));
    stub.list.mockResolvedValue(null);

    await handleOverrideBrowseButton(makeConfig(), buttonInteraction('test-override::clear::p1'));

    expect(stub.delete).toHaveBeenCalledWith('p1', undefined);
    expect(editReply).toHaveBeenCalledWith({
      content: '❌ Failed to load overrides. Please try again later.',
      embeds: [],
      components: [],
    });
  });

  it('shows a generic error (clearing stale view) when delete throws after deferring', async () => {
    stub.delete.mockRejectedValue(new Error('network'));

    await handleOverrideBrowseButton(makeConfig(), buttonInteraction('test-override::clear::p1'));

    expect(deferUpdate).toHaveBeenCalled();
    expect(editReply).toHaveBeenCalledWith({
      content: '❌ An error occurred. Please try again later.',
      embeds: [],
      components: [],
    });
  });

  it('ignores a select customId routed to the button handler', async () => {
    await handleOverrideBrowseButton(makeConfig(), buttonInteraction('test-override::select'));
    expect(deferUpdate).not.toHaveBeenCalled();
    expect(stub.delete).not.toHaveBeenCalled();
  });
});
