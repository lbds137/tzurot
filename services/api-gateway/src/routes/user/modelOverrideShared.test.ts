import { describe, it, expect, vi } from 'vitest';
import type { Response } from 'express';
import { ADMIN_SETTINGS_SINGLETON_ID } from '@tzurot/common-types/schemas/api/adminSettings';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import type { ModelCapabilityService } from '../../services/ModelCapabilityService.js';
import {
  parseClearSlots,
  buildOverrideSummary,
  resolveClearFallbackDefaults,
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

describe('resolveClearFallbackDefaults', () => {
  /** All four pointer columns the tier pick reads, in the fixed-shape select. */
  const POINTER_SELECT = {
    globalDefaultLlmConfigId: true,
    globalDefaultVisionConfigId: true,
    freeDefaultLlmConfigId: true,
    freeDefaultVisionConfigId: true,
  };

  /**
   * Build a mock Prisma with the adminSettings row (or null) preloaded and
   * per-call llmConfig rows queued via mockResolvedValueOnce by the caller.
   */
  function buildPrisma(settingsRow: Record<string, string | null> | null) {
    const adminSettings = { findUnique: vi.fn().mockResolvedValue(settingsRow) };
    const llmConfig = { findUnique: vi.fn().mockResolvedValue(null) };
    const prisma = { adminSettings, llmConfig } as unknown as PrismaClient;
    return { prisma, adminSettings, llmConfig };
  }

  it('keyed:true with a settings row resolves the GLOBAL pointers (both slots)', async () => {
    const { prisma, adminSettings, llmConfig } = buildPrisma({
      globalDefaultLlmConfigId: 'global-text',
      globalDefaultVisionConfigId: 'global-vision',
      freeDefaultLlmConfigId: 'free-text',
      freeDefaultVisionConfigId: 'free-vision',
    });
    llmConfig.findUnique
      .mockResolvedValueOnce({ id: 'global-text', name: 'Global Text' })
      .mockResolvedValueOnce({ id: 'global-vision', name: 'Global Vision' });

    const result = await resolveClearFallbackDefaults(prisma, true, true, true);

    // Reads ALL four pointers in one fixed-shape singleton query (the tier
    // pick happens in TS, never in a second DB round-trip).
    expect(adminSettings.findUnique).toHaveBeenCalledWith({
      where: { id: ADMIN_SETTINGS_SINGLETON_ID },
      select: POINTER_SELECT,
    });
    // The KEYED branch resolves the GLOBAL pointers — the free ids never reach
    // a lookup, even though they are configured.
    expect(llmConfig.findUnique).toHaveBeenCalledWith({
      where: { id: 'global-text' },
      select: { id: true, name: true },
    });
    expect(llmConfig.findUnique).toHaveBeenCalledWith({
      where: { id: 'global-vision' },
      select: { id: true, name: true },
    });
    expect(result).toEqual({
      text: { id: 'global-text', name: 'Global Text' },
      vision: { id: 'global-vision', name: 'Global Vision' },
    });
  });

  it('keyed:false resolves the FREE pointers instead', async () => {
    const { prisma, llmConfig } = buildPrisma({
      globalDefaultLlmConfigId: 'global-text',
      globalDefaultVisionConfigId: 'global-vision',
      freeDefaultLlmConfigId: 'free-text',
      freeDefaultVisionConfigId: 'free-vision',
    });
    llmConfig.findUnique
      .mockResolvedValueOnce({ id: 'free-text', name: 'Free Text' })
      .mockResolvedValueOnce({ id: 'free-vision', name: 'Free Vision' });

    const result = await resolveClearFallbackDefaults(prisma, true, true, false);

    expect(llmConfig.findUnique).toHaveBeenCalledWith({
      where: { id: 'free-text' },
      select: { id: true, name: true },
    });
    expect(llmConfig.findUnique).toHaveBeenCalledWith({
      where: { id: 'free-vision' },
      select: { id: true, name: true },
    });
    expect(result).toEqual({
      text: { id: 'free-text', name: 'Free Text' },
      vision: { id: 'free-vision', name: 'Free Vision' },
    });
  });

  it('a null settings row (keyed:true) yields null for both slots without a lookup — no crash', async () => {
    const { prisma, llmConfig } = buildPrisma(null);

    const result = await resolveClearFallbackDefaults(prisma, true, true, true);

    // bot-client renders null as the built-in-fallback notice; nothing throws.
    expect(result).toEqual({ text: null, vision: null });
    expect(llmConfig.findUnique).not.toHaveBeenCalled();
  });
});
