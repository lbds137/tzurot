import { describe, expect, it } from 'vitest';
import { selectRenderableDigestText } from './recentDaysDigestRenderGate.js';
import type { RenderableDigestRow } from './recentDaysDigestStore.js';

const NOW = new Date('2026-09-17T00:00:00.000Z');
const SEVEN_DAYS_MS = 7 * 86_400_000;

function makeRow(overrides: Partial<RenderableDigestRow> = {}): RenderableDigestRow {
  return {
    text: 'DIGEST SENTINEL',
    generatedAt: NOW,
    sourceEpoch: null,
    ...overrides,
  };
}

describe('selectRenderableDigestText', () => {
  it('returns undefined for a null row', () => {
    expect(selectRenderableDigestText(null, { now: NOW, currentEpoch: null })).toBeUndefined();
  });

  it('renders when generatedAt is just inside the window', () => {
    const row = makeRow({ generatedAt: new Date(NOW.getTime() - SEVEN_DAYS_MS + 60_000) });
    expect(selectRenderableDigestText(row, { now: NOW, currentEpoch: null })).toBe(
      'DIGEST SENTINEL'
    );
  });

  it('omits when generatedAt is just outside the window', () => {
    const row = makeRow({ generatedAt: new Date(NOW.getTime() - SEVEN_DAYS_MS - 60_000) });
    expect(selectRenderableDigestText(row, { now: NOW, currentEpoch: null })).toBeUndefined();
  });

  it('renders when both epochs are null', () => {
    const row = makeRow({ sourceEpoch: null });
    expect(selectRenderableDigestText(row, { now: NOW, currentEpoch: null })).toBe(
      'DIGEST SENTINEL'
    );
  });

  it('omits when sourceEpoch is null but currentEpoch is a Date', () => {
    const row = makeRow({ sourceEpoch: null });
    expect(
      selectRenderableDigestText(row, { now: NOW, currentEpoch: new Date('2026-09-01') })
    ).toBeUndefined();
  });

  it('omits when sourceEpoch is a Date but currentEpoch is null', () => {
    const row = makeRow({ sourceEpoch: new Date('2026-09-01') });
    expect(selectRenderableDigestText(row, { now: NOW, currentEpoch: null })).toBeUndefined();
  });

  it('renders when two distinct Date objects share the same getTime() (reference-equality canary)', () => {
    const row = makeRow({ sourceEpoch: new Date('2026-09-01T00:00:00.000Z') });
    const currentEpoch = new Date('2026-09-01T00:00:00.000Z');
    expect(row.sourceEpoch).not.toBe(currentEpoch); // distinct objects, same instant
    expect(selectRenderableDigestText(row, { now: NOW, currentEpoch })).toBe('DIGEST SENTINEL');
  });

  it('omits when the epochs differ in time', () => {
    const row = makeRow({ sourceEpoch: new Date('2026-09-01T00:00:00.000Z') });
    const currentEpoch = new Date('2026-09-02T00:00:00.000Z');
    expect(selectRenderableDigestText(row, { now: NOW, currentEpoch })).toBeUndefined();
  });
});
