/**
 * Tests for the shared multi-select batch helpers.
 */

import { describe, it, expect } from 'vitest';
import { ButtonStyle } from 'discord.js';

import {
  buildBatchConfirmView,
  buildSelectSeveralToggle,
  encodeBatchFooterIds,
  parseBatchFooterIds,
  runBatchSequentially,
  formatBatchItemLines,
  type BatchConfirmView,
} from './multiSelectBatch.js';

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
