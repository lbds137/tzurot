/**
 * Tests for the shared multi-select batch helpers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ButtonStyle, EmbedBuilder, type ButtonInteraction, type Message } from 'discord.js';

import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';

import {
  batchResultColor,
  buildBatchConfirmView,
  buildSelectSeveralToggle,
  buildBatchResultEmbed,
  clampBatchConfirmDescription,
  deliverBatchReport,
  encodeBatchFooterIds,
  formatBatchCountsLine,
  formatBatchItemLines,
  formatFallbackIdLabel,
  parseBatchFooterIds,
  readSelectOptionLabels,
  runBatchSequentially,
  toBatchOutcomeLine,
  type BatchConfirmView,
} from './multiSelectBatch.js';
import { PAGE_FETCH_FAILED_COPY } from './multiSelectBatch.js';

const followUpSpecMock = vi.hoisted(() => vi.fn());
vi.mock('../../ux/render/reply.js', () => ({ followUpSpec: followUpSpecMock }));

// Real CATALOG everywhere (the module graph reads it at load time) except
// info.note, overridden to identity so the ladder test can assert the
// countsLine reached followUpSpec verbatim.
vi.mock('../../ux/catalog/catalog.js', async () => {
  const actual = await vi.importActual<typeof import('../../ux/catalog/catalog.js')>(
    '../../ux/catalog/catalog.js'
  );
  return {
    ...actual,
    CATALOG: {
      ...actual.CATALOG,
      info: { ...actual.CATALOG.info, note: (text: string) => text },
    },
  };
});

describe('PAGE_FETCH_FAILED_COPY', () => {
  it('names the page, not the session — a failed fetch is not an expiry', () => {
    expect(PAGE_FETCH_FAILED_COPY).toContain("Couldn't load that page");
    expect(PAGE_FETCH_FAILED_COPY.toLowerCase()).not.toContain('expired');
  });
});

describe('deliverBatchReport (the shared survival ladder)', () => {
  function createInteraction(): ButtonInteraction {
    return {
      editReply: vi.fn().mockResolvedValue(undefined),
      followUp: vi.fn().mockResolvedValue(undefined),
    } as unknown as ButtonInteraction;
  }

  function resultEmbed(): EmbedBuilder {
    return buildBatchResultEmbed({ title: 'Results', color: 0x00ff00, lines: ['x'] });
  }

  const view = { embed: new EmbedBuilder().setTitle('list'), components: [] };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stacks the result embed over the refreshed view in one editReply', async () => {
    const interaction = createInteraction();

    await deliverBatchReport(interaction, {
      resultEmbed: resultEmbed(),
      viewPromise: Promise.resolve(view),
      countsLine: 'Batch finished: 1 succeeded.',
      verb: 'delete',
    });

    expect(interaction.editReply).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(interaction.editReply).mock.calls[0]?.[0] as {
      embeds: unknown[];
      components: unknown[];
    };
    expect(payload.embeds).toHaveLength(2);
    expect(followUpSpecMock).not.toHaveBeenCalled();
  });

  it('delivers the result embed alone when the view degraded to null', async () => {
    const interaction = createInteraction();

    await deliverBatchReport(interaction, {
      resultEmbed: resultEmbed(),
      viewPromise: Promise.resolve(null),
      countsLine: 'Batch finished: 1 succeeded.',
      verb: 'lock',
    });

    const payload = vi.mocked(interaction.editReply).mock.calls[0]?.[0] as {
      embeds: unknown[];
      components: unknown[];
    };
    expect(payload.embeds).toHaveLength(1);
    expect(payload.components).toEqual([]);
    expect(followUpSpecMock).not.toHaveBeenCalled();
  });

  it('falls back to the counts followUp when BOTH reply attempts reject', async () => {
    const interaction = createInteraction();
    vi.mocked(interaction.editReply)
      .mockRejectedValueOnce(new Error('Invalid Form Body'))
      .mockRejectedValueOnce(new Error('Unknown Message'));

    await deliverBatchReport(interaction, {
      resultEmbed: resultEmbed(),
      viewPromise: Promise.resolve(view),
      countsLine: 'Batch finished: 2 succeeded, 1 already gone, 0 already locked, 0 failed.',
      verb: 'delete',
    });

    expect(interaction.editReply).toHaveBeenCalledTimes(2);
    expect(followUpSpecMock).toHaveBeenCalledWith(
      interaction,
      'Batch finished: 2 succeeded, 1 already gone, 0 already locked, 0 failed.'
    );
  });
});

describe('buildSelectSeveralToggle', () => {
  type ToggleData = { custom_id: string; label: string; style: number };

  it('builds a Secondary button with the caller customId and label', () => {
    const json = buildSelectSeveralToggle('memory-fact::batch-select').toJSON() as ToggleData;
    expect(json.custom_id).toBe('memory-fact::batch-select');
    expect(json.label).toBe('Select several');
    expect(json.style).toBe(ButtonStyle.Secondary);
  });

  it('accepts a custom label', () => {
    const json = buildSelectSeveralToggle('x::y', 'Pick many').toJSON() as ToggleData;
    expect(json.label).toBe('Pick many');
  });
});

describe('footer id state (encode/parse)', () => {
  it('round-trips a list of ids losslessly', () => {
    const ids = ['fact-a', 'fact-b', 'fact-c'];
    expect(parseBatchFooterIds(encodeBatchFooterIds(ids))).toEqual(ids);
  });

  it('returns null for an absent or empty footer', () => {
    expect(parseBatchFooterIds(undefined)).toBeNull();
    expect(parseBatchFooterIds('')).toBeNull();
  });

  it('treats a whitespace-free id list with no ids as null (empty join)', () => {
    expect(parseBatchFooterIds('\n\n')).toBeNull();
  });
});

describe('footer budget (C4 — 25 realistic ids)', () => {
  // Realistic fact ids: UUID-shaped, like the gateway's generated fact rows.
  const realisticIds = Array.from(
    { length: 25 },
    (_, i) => `3f9c2e7a-8b4d-4c1a-9d6e-${(i + 1).toString().padStart(12, '0')}`
  );

  it('encodes 25 realistic ids under the 2049-character footer cap and parses them back losslessly', () => {
    const encoded = encodeBatchFooterIds(realisticIds);
    expect(encoded.length).toBeLessThan(2049);
    expect(parseBatchFooterIds(encoded)).toEqual(realisticIds);
  });

  it('keeps every one of the 25 ids distinct after the round-trip', () => {
    const parsed = parseBatchFooterIds(encodeBatchFooterIds(realisticIds));
    expect(new Set(parsed).size).toBe(25);
  });
});

describe('runBatchSequentially', () => {
  it('returns every value in input order when all ops succeed', async () => {
    const results = await runBatchSequentially(['a', 'b', 'c'], async id => `v-${id}`);
    expect(results).toEqual([
      { id: 'a', ok: true, value: 'v-a' },
      { id: 'b', ok: true, value: 'v-b' },
      { id: 'c', ok: true, value: 'v-c' },
    ]);
  });

  it('isolates a throwing op: the run continues and the failure is recorded', async () => {
    const seen: string[] = [];
    const boom = new Error('locked');
    const results = await runBatchSequentially(['f1', 'f2', 'f3'], async id => {
      seen.push(id);
      if (id === 'f2') {
        throw boom;
      }
      return `v-${id}`;
    });

    // The loop reached ALL ids — one failure never stops the run.
    expect(seen).toEqual(['f1', 'f2', 'f3']);
    expect(results[0]).toEqual({ id: 'f1', ok: true, value: 'v-f1' });
    expect(results[1]).toEqual({ id: 'f2', ok: false, error: boom });
    expect(results[2]).toEqual({ id: 'f3', ok: true, value: 'v-f3' });
  });

  it('runs strictly sequentially (op N+1 starts only after op N resolves)', async () => {
    const active: string[] = [];
    let maxConcurrent = 0;
    await runBatchSequentially(['a', 'b', 'c'], async id => {
      active.push(id);
      maxConcurrent = Math.max(maxConcurrent, active.length);
      await new Promise<void>(resolve => queueMicrotask(resolve));
      active.splice(active.indexOf(id), 1);
    });
    expect(maxConcurrent).toBe(1);
  });
});

describe('buildBatchConfirmView', () => {
  type ButtonJson = { custom_id: string; style: number };
  const rowButtons = (view: BatchConfirmView): ButtonJson[] =>
    view.components.flatMap(row => (row.toJSON().components ?? []) as ButtonJson[]);

  it('places the secondary verb row above the factory row (Cancel, then Danger last)', () => {
    const view = buildBatchConfirmView({
      title: '⚠️ Manage Several Facts',
      description: '• fact one',
      footerText: 'id-a\nid-b',
      secondaryVerb: { customId: 'x::lock', label: 'Lock (2)', emoji: '🔐' },
      confirm: { customId: 'x::forget', label: 'Forget (2)', emoji: '🗑️' },
      cancelCustomId: 'x::cancel',
    });

    expect(view.embed.toJSON().footer?.text).toBe('id-a\nid-b');
    const buttons = rowButtons(view);
    expect(buttons.map(button => button.style)).toEqual([
      ButtonStyle.Secondary,
      ButtonStyle.Secondary,
      ButtonStyle.Danger,
    ]);
    expect(buttons[2].custom_id).toBe('x::forget');
  });

  it('renders the factory row alone when no secondary verb is given', () => {
    const view = buildBatchConfirmView({
      title: 'Remove Entries',
      description: '• entry one',
      footerText: 'id-a',
      confirm: { customId: 'x::remove', label: 'Remove (1)' },
      cancelCustomId: 'x::cancel',
    });

    const buttons = rowButtons(view);
    expect(buttons).toHaveLength(2);
    expect(buttons.map(button => button.style)).toEqual([
      ButtonStyle.Secondary,
      ButtonStyle.Danger,
    ]);
    expect(buttons[1].custom_id).toBe('x::remove');
  });
});

describe('readSelectOptionLabels (the shared option-label walker)', () => {
  /** A message-like stub: discord.js rehydrates rows as builders, so the walker reads toJSON(). */
  const messageWithRows = (rows: unknown[]): Message =>
    ({ components: rows.map(row => ({ toJSON: () => row })) }) as unknown as Message;

  it('maps option value → label across a multi-select row', () => {
    const labels = readSelectOptionLabels(
      messageWithRows([
        {
          type: 1,
          components: [
            {
              type: 3,
              options: [
                { value: 'mem-1', label: '1. 🔐 first memory' },
                { value: 'mem-2', label: '2. second memory' },
              ],
            },
          ],
        },
      ])
    );
    expect(labels.get('mem-1')).toBe('1. 🔐 first memory');
    expect(labels.get('mem-2')).toBe('2. second memory');
    expect(labels.size).toBe(2);
  });

  it('walks nested component trees and degrades a non-string label to the value', () => {
    const labels = readSelectOptionLabels(
      messageWithRows([
        {
          type: 1,
          components: [
            {
              type: 1,
              components: [{ type: 3, options: [{ value: 'deep-id', label: 42 }] }],
            },
          ],
        },
      ])
    );
    expect(labels.get('deep-id')).toBe('deep-id');
  });
});

describe('formatFallbackIdLabel', () => {
  it('shortens the id under the caller noun with an ellipsis', () => {
    expect(formatFallbackIdLabel('3f9c2e7a-8b4d-4c1a-9d6e-000000000001', 'Memory')).toBe(
      'Memory ID: 3f9c2e7a…'
    );
    expect(formatFallbackIdLabel('fact-1', 'Fact')).toBe('Fact ID: fact-1…');
  });
});

describe('clampBatchConfirmDescription (clamp the listing, not the warning)', () => {
  const warning = '**This affects 2 memories immediately.** Delete is permanent.';

  it('keeps a short listing and the warning whole', () => {
    const description = clampBatchConfirmDescription('• first\n• second', warning);
    expect(description).toBe(`• first\n• second\n\n${warning}`);
  });

  it('cuts a listing that would overflow the budget but always appends the warning whole', () => {
    const longListing = Array.from({ length: 100 }, (_, i) => `• item ${i.toString()}`).join('\n');
    const description = clampBatchConfirmDescription(longListing, warning);
    expect(description.endsWith(warning)).toBe(true);
    expect(description.length).toBeLessThanOrEqual(3800);
    expect(description.startsWith('• item 0')).toBe(true);
  });
});

describe('formatBatchItemLines', () => {
  it('renders each status glyph, with the note when present', () => {
    expect(
      formatBatchItemLines([
        { label: 'fact one', status: 'success' },
        { label: 'fact two', status: 'gone', note: 'already gone' },
        { label: 'fact three', status: 'failed', note: 'server error' },
      ])
    ).toEqual(['✅ fact one', '◻️ fact two — already gone', '❌ fact three — server error']);
  });
});

describe('toBatchOutcomeLine', () => {
  it('maps a success outcome to a note-less success line', () => {
    expect(
      toBatchOutcomeLine({ id: 'a', ok: true, value: 'success' }, 'Alpha', 'fallback')
    ).toEqual({ label: 'Alpha', status: 'success' });
  });

  it('maps an already-gone outcome to a gone line with the "already gone" note', () => {
    expect(
      toBatchOutcomeLine({ id: 'a', ok: true, value: 'already-gone' }, 'Alpha', 'fallback')
    ).toEqual({ label: 'Alpha', status: 'gone', note: 'already gone' });
  });

  it('uses the thrown Error message as the failed note', () => {
    expect(
      toBatchOutcomeLine({ id: 'a', ok: false, error: new Error('boom') }, 'Alpha', 'fallback')
    ).toEqual({ label: 'Alpha', status: 'failed', note: 'boom' });
  });

  it('falls back when the error is empty-message or not an Error', () => {
    expect(
      toBatchOutcomeLine({ id: 'a', ok: false, error: new Error('') }, 'Alpha', 'fallback')
    ).toEqual({ label: 'Alpha', status: 'failed', note: 'fallback' });
    expect(toBatchOutcomeLine({ id: 'a', ok: false, error: 'str' }, 'Alpha', 'fallback')).toEqual({
      label: 'Alpha',
      status: 'failed',
      note: 'fallback',
    });
  });
});

describe('batchResultColor', () => {
  it('is red whenever anything failed, even alongside successes', () => {
    expect(batchResultColor({ succeeded: 3, failed: 1 })).toBe(DISCORD_COLORS.ERROR);
    expect(batchResultColor({ succeeded: 0, failed: 2 })).toBe(DISCORD_COLORS.ERROR);
  });

  it('is warning amber when nothing succeeded and nothing failed', () => {
    expect(batchResultColor({ succeeded: 0, failed: 0 })).toBe(DISCORD_COLORS.WARNING);
  });

  it('is green when something succeeded and nothing failed', () => {
    expect(batchResultColor({ succeeded: 2, failed: 0 })).toBe(DISCORD_COLORS.SUCCESS);
  });
});

describe('formatBatchCountsLine', () => {
  it('renders the succeeded / already gone / failed counts copy', () => {
    expect(formatBatchCountsLine({ succeeded: 2, gone: 1, failed: 3 })).toBe(
      'Batch finished: 2 succeeded, 1 already gone, 3 failed.'
    );
  });
});
