import { describe, it, expect, afterEach } from 'vitest';
import { FREE_ROUTER_MODEL } from '@tzurot/common-types/constants/ai';
import {
  registerSystemSettings,
  resetSystemSettingsRegistration,
  type SystemSettingsService,
} from '@tzurot/common-types/services/SystemSettingsService';
import { getFreeTextFloor, getFreeVisionFloor } from './freeFloors.js';

function registerFloors(text: string, vision: string): void {
  registerSystemSettings({
    get: (key: string) =>
      key === 'fallbackTextModelFree'
        ? text
        : key === 'fallbackVisionModelFree'
          ? vision
          : undefined,
  } as unknown as SystemSettingsService);
}

afterEach(() => resetSystemSettingsRegistration());

describe('free-floor billing firewall', () => {
  it('passes a genuinely free configured floor through (divergent-from-fallback value)', () => {
    registerFloors('divergent/text:free', 'divergent/vision:free');
    expect(getFreeTextFloor()).toBe('divergent/text:free');
    expect(getFreeVisionFloor()).toBe('divergent/vision:free');
  });

  it('degrades a NON-free bag value to the static router — an out-of-band edit can never bill the owner', () => {
    registerFloors('paid/sneaky-text', 'paid/sneaky-vision');
    expect(getFreeTextFloor()).toBe(FREE_ROUTER_MODEL);
    expect(getFreeVisionFloor()).toBe(FREE_ROUTER_MODEL);
  });

  it('serves the registry fallbacks (already free) when nothing is registered', () => {
    expect(getFreeTextFloor()).toBe(FREE_ROUTER_MODEL);
    expect(getFreeVisionFloor()).toBe(FREE_ROUTER_MODEL);
  });
});
