import { describe, it, expect, vi } from 'vitest';
import type { Response } from 'express';
import { parseClearSlots, OVERRIDE_SUMMARY_SELECT } from './modelOverrideShared.js';

const mockParseAllowAll = vi.hoisted(() => vi.fn());
vi.mock('../../utils/configRouteHelpers.js', () => ({
  parseModelSlotQueryAllowAll: mockParseAllowAll,
}));

describe('parseClearSlots', () => {
  const res = {} as Response;

  it.each([
    ['text', { slot: 'text', clearText: true, clearVision: false }],
    ['vision', { slot: 'vision', clearText: false, clearVision: true }],
    ['all', { slot: 'all', clearText: true, clearVision: true }],
  ])('derives the cleared FK columns for slot=%s', (slot, expected) => {
    mockParseAllowAll.mockReturnValue(slot);

    expect(parseClearSlots(res, {})).toEqual(expected);
  });

  it('returns null when the slot parser already sent the error', () => {
    mockParseAllowAll.mockReturnValue(null);

    expect(parseClearSlots(res, {})).toBeNull();
  });
});

describe('OVERRIDE_SUMMARY_SELECT', () => {
  it('selects both slot FKs and the models that feed the supportsVision badge', () => {
    expect(OVERRIDE_SUMMARY_SELECT.llmConfig.select.model).toBe(true);
    expect(OVERRIDE_SUMMARY_SELECT.visionConfig.select.model).toBe(true);
    expect(OVERRIDE_SUMMARY_SELECT.llmConfigId).toBe(true);
    expect(OVERRIDE_SUMMARY_SELECT.visionConfigId).toBe(true);
  });
});
