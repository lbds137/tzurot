import { describe, it, expect, vi } from 'vitest';
import type { Response } from 'express';
import type { ModelCapabilityService } from '../../services/ModelCapabilityService.js';
import {
  parseClearSlots,
  buildOverrideSummary,
  OVERRIDE_SUMMARY_SELECT,
  type OverrideSummaryRow,
} from './modelOverrideShared.js';

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

describe('buildOverrideSummary', () => {
  const row: OverrideSummaryRow = {
    personalityId: 'p-1',
    personality: { name: 'Alice' },
    llmConfigId: 'cfg-text',
    llmConfig: { name: 'Text Preset', model: 'text/model' },
    visionConfigId: 'cfg-vision',
    visionConfig: { name: 'Vision Preset', model: 'vision/model' },
  };

  function capabilitiesStub(supportsVision = true): ModelCapabilityService {
    return {
      supportsVision: vi.fn().mockResolvedValue(supportsVision),
    } as unknown as ModelCapabilityService;
  }

  it("emits the text slot's config and enriches from the TEXT model", async () => {
    const capabilities = capabilitiesStub(false);
    const summary = await buildOverrideSummary(row, 'text', capabilities);

    expect(summary).toEqual({
      personalityId: 'p-1',
      personalityName: 'Alice',
      configId: 'cfg-text',
      configName: 'Text Preset',
      slot: 'text',
      supportsVision: false,
    });
    expect(capabilities.supportsVision).toHaveBeenCalledWith('text/model');
  });

  it("emits the vision slot's config and enriches from the VISION model", async () => {
    const capabilities = capabilitiesStub(true);
    const summary = await buildOverrideSummary(row, 'vision', capabilities);

    expect(summary).toEqual({
      personalityId: 'p-1',
      personalityName: 'Alice',
      configId: 'cfg-vision',
      configName: 'Vision Preset',
      slot: 'vision',
      supportsVision: true,
    });
    expect(capabilities.supportsVision).toHaveBeenCalledWith('vision/model');
  });

  it('handles a null joined config (name null, empty model to the capability check)', async () => {
    const capabilities = capabilitiesStub(false);
    const summary = await buildOverrideSummary(
      { ...row, llmConfig: null, llmConfigId: null },
      'text',
      capabilities
    );

    expect(summary.configId).toBeNull();
    expect(summary.configName).toBeNull();
    expect(capabilities.supportsVision).toHaveBeenCalledWith('');
  });
});
