import { describe, it, expect } from 'vitest';
import {
  AUTO_ROUTER_MODEL,
  FREE_ROUTER_MODEL,
  isFreeModel,
  ZAI_FREE_TIER_MODEL,
} from '../../constants/ai.js';
import { MULTI_TAG } from '../../constants/message.js';
import { SystemSettingsSchema } from './systemSettings.js';
import {
  SYSTEM_SETTINGS_REGISTRY,
  SYSTEM_SETTINGS_KEYS,
  SYSTEM_SETTINGS_FALLBACKS,
  buildSystemSettingsSeed,
} from './systemSettingsRegistry.js';

describe('SYSTEM_SETTINGS_REGISTRY completeness', () => {
  it('has an entry for every schema key (inverse of the compile-time check)', () => {
    const schemaKeys = Object.keys(SystemSettingsSchema.shape).sort();
    const registryKeys = [...SYSTEM_SETTINGS_KEYS].sort();
    expect(registryKeys).toEqual(schemaKeys);
  });

  it('every entry key field matches its record key', () => {
    for (const key of SYSTEM_SETTINGS_KEYS) {
      expect(SYSTEM_SETTINGS_REGISTRY[key].key).toBe(key);
    }
  });

  it('model metadata is present exactly on model-control entries', () => {
    for (const key of SYSTEM_SETTINGS_KEYS) {
      const meta = SYSTEM_SETTINGS_REGISTRY[key];
      expect(meta.model !== undefined).toBe(meta.control === 'model');
    }
  });

  it('choices are present exactly on enum-control entries', () => {
    for (const key of SYSTEM_SETTINGS_KEYS) {
      const meta = SYSTEM_SETTINGS_REGISTRY[key];
      expect(meta.choices !== undefined).toBe(meta.control === 'enum');
    }
  });

  it('bounds metadata is present exactly on integer-control entries', () => {
    for (const key of SYSTEM_SETTINGS_KEYS) {
      const meta = SYSTEM_SETTINGS_REGISTRY[key];
      expect(meta.min !== undefined).toBe(meta.control === 'integer');
      if (meta.max !== undefined) {
        expect(meta.control).toBe('integer');
      }
    }
  });

  it('a min of ZERO counts as present bounds metadata (0 must not read as "absent")', () => {
    // nightlySyncHourUtc is the first integer setting whose floor is 0. Every
    // bounds check here is written `!== undefined` rather than truthy for
    // exactly this reason — a truthy test would skip the key's parity check.
    const meta = SYSTEM_SETTINGS_REGISTRY.nightlySyncHourUtc;
    expect(meta.min).toBe(0);
    expect(meta.min !== undefined).toBe(true);
    expect(meta.max).toBe(23);
  });

  it('registry bounds behaviorally match the zod schema (the no-drift parity check)', () => {
    // The schema stays authoritative for validation; the registry mirrors bounds
    // for input surfaces. Parity is asserted behaviorally (accept/reject at the
    // boundary), so it survives zod internals changing shape.
    for (const key of SYSTEM_SETTINGS_KEYS) {
      const meta = SYSTEM_SETTINGS_REGISTRY[key];
      if (meta.control !== 'integer' || meta.min === undefined) {
        continue;
      }
      const field = SystemSettingsSchema.shape[key];
      expect(field.safeParse(meta.min).success, `${key} accepts min`).toBe(true);
      expect(field.safeParse(meta.min - 1).success, `${key} rejects min-1`).toBe(false);
      if (meta.max !== undefined) {
        expect(field.safeParse(meta.max).success, `${key} accepts max`).toBe(true);
        expect(field.safeParse(meta.max + 1).success, `${key} rejects max+1`).toBe(false);
      } else {
        expect(field.safeParse(Number.MAX_SAFE_INTEGER).success, `${key} is unbounded above`).toBe(
          true
        );
      }
    }
  });

  it('a list-control entry falls back to an array', () => {
    for (const key of SYSTEM_SETTINGS_KEYS) {
      const meta = SYSTEM_SETTINGS_REGISTRY[key];
      if (meta.control === 'list') {
        expect(Array.isArray(meta.fallback)).toBe(true);
      }
    }
  });
});

describe('fallbacks (the floor beneath the floor)', () => {
  it('the full fallback bag parses against the resolved schema', () => {
    expect(() => SystemSettingsSchema.parse(SYSTEM_SETTINGS_FALLBACKS)).not.toThrow();
  });

  it('feature flags fall back OFF (a lost DB never silently enables a feature)', () => {
    expect(SYSTEM_SETTINGS_FALLBACKS.extractionEnabled).toBe(false);
    expect(SYSTEM_SETTINGS_FALLBACKS.factsInPromptEnabled).toBe(false);
    expect(SYSTEM_SETTINGS_FALLBACKS.zaiFreeTierEnabled).toBe(false);
    // A lost DB must never silently reshape every persona's system prompt —
    // this is a staged structural rollout switch, not an independent feature.
    expect(SYSTEM_SETTINGS_FALLBACKS.realMessagesEnabled).toBe(false);
  });

  it('the archive split-render switch falls back to an empty list (every character renders verbatim)', () => {
    expect(SYSTEM_SETTINGS_FALLBACKS.archiveSplitRenderPersonalities).toEqual([]);
  });

  it('the nightly sync falls back ENABLED at 07:00 UTC (a lost DB keeps dev↔prod converging)', () => {
    // Deliberate exception to the flags-fall-back-OFF rule above: the sync is
    // idempotent, silent when nothing moved, and gated to the prod bot-client.
    expect(SYSTEM_SETTINGS_FALLBACKS.nightlySyncEnabled).toBe(true);
    expect(SYSTEM_SETTINGS_FALLBACKS.nightlySyncHourUtc).toBe(7);
  });

  it('header-spoof neutralization falls back ENABLED (a hardening default, not a staged rollout)', () => {
    // Deliberate exception to the flags-fall-back-OFF rule above: unlike the
    // realMessagesEnabled rollout switch it rides, this is a hardening
    // measure with no staged-rollout semantics — a lost DB row must not
    // silently reopen the spoof path on a flag-on deployment.
    expect(SYSTEM_SETTINGS_FALLBACKS.headerSpoofNeutralizeEnabled).toBe(true);
  });

  it('the multi-character cap falls back to the in-code MULTI_TAG constant', () => {
    // bot-client resolves the cap through this same constant when the gateway
    // read fails, so registry fallback and in-code floor must be one value.
    expect(SYSTEM_SETTINGS_FALLBACKS.multiTagMaxCharacters).toBe(MULTI_TAG.MAX_TAGS);
  });

  it('free floors fall back to a free-route model (billing firewall holds even at the floor)', () => {
    expect(isFreeModel(SYSTEM_SETTINGS_FALLBACKS.fallbackTextModelFree)).toBe(true);
    expect(isFreeModel(SYSTEM_SETTINGS_FALLBACKS.fallbackVisionModelFree)).toBe(true);
  });
});

describe('buildSystemSettingsSeed', () => {
  it('produces a bag that parses against the resolved schema', () => {
    const seed = buildSystemSettingsSeed();
    expect(() => SystemSettingsSchema.parse(seed)).not.toThrow();
  });

  it('seeds the registry fallbacks — flags dark, floors on the router aliases (owner directives 7/8)', () => {
    // With the env vars deleted, the seed IS the fallback set;
    // existing environments keep their env-derived bags (seed never clobbers).
    const seed = buildSystemSettingsSeed();
    expect(seed).toEqual(SYSTEM_SETTINGS_FALLBACKS);
    expect(seed.extractionEnabled).toBe(false);
    expect(seed.factsInPromptEnabled).toBe(false);
    expect(seed.zaiFreeTierEnabled).toBe(false);
    expect(seed.realMessagesEnabled).toBe(false);
    expect(seed.headerSpoofNeutralizeEnabled).toBe(true);
    expect(seed.fallbackTextModel).toBe(AUTO_ROUTER_MODEL);
    expect(seed.fallbackVisionModel).toBe(AUTO_ROUTER_MODEL);
    expect(seed.fallbackTextModelFree).toBe(FREE_ROUTER_MODEL);
    expect(seed.fallbackVisionModelFree).toBe(FREE_ROUTER_MODEL);
  });
});

describe('admin-visible copy tracks the constants it describes', () => {
  it("the z.ai free-tier toggle's description names the model guests actually ride", () => {
    // This description renders verbatim into the /admin settings embed, so it
    // is the one place a human reads the piggyback model's name. It drifted
    // once already: the constant moved off glm-4.5-air after a probe showed
    // z.ai rerouting that id, and the description kept naming the retired one.
    const { description } = SYSTEM_SETTINGS_REGISTRY.zaiFreeTierEnabled;
    expect(description.toLowerCase()).toContain(ZAI_FREE_TIER_MODEL);
  });
});

describe('realMessagesEnabled (prompt-assembly Phase 2 rollout switch)', () => {
  it('is a live-toggling boolean in the operations group, falling back OFF', () => {
    const meta = SYSTEM_SETTINGS_REGISTRY.realMessagesEnabled;
    expect(meta.control).toBe('boolean');
    expect(meta.group).toBe('operations');
    expect(meta.liveness).toBe('live');
    expect(meta.fallback).toBe(false);
  });
});

describe('headerSpoofNeutralizeEnabled (prompt-assembly kill switch)', () => {
  it('is a live-toggling boolean in the operations group, falling back ON', () => {
    const meta = SYSTEM_SETTINGS_REGISTRY.headerSpoofNeutralizeEnabled;
    expect(meta.control).toBe('boolean');
    expect(meta.group).toBe('operations');
    expect(meta.liveness).toBe('live');
    expect(meta.fallback).toBe(true);
  });
});

describe('archiveSplitRenderPersonalities (memory-archive split render switch)', () => {
  it('is a live-toggling list in the operations group, falling back to an empty array', () => {
    const meta = SYSTEM_SETTINGS_REGISTRY.archiveSplitRenderPersonalities;
    expect(meta.control).toBe('list');
    expect(meta.group).toBe('operations');
    expect(meta.liveness).toBe('live');
    expect(meta.fallback).toEqual([]);
  });
});
