import { describe, it, expect } from 'vitest';
import { SYSTEM_SETTINGS_REGISTRY_OPERATIONS } from './systemSettingsRegistryOperations.js';
import { SYSTEM_SETTINGS_REGISTRY } from './systemSettingsRegistry.js';

describe('SYSTEM_SETTINGS_REGISTRY_OPERATIONS', () => {
  it('every entry key field matches its record key', () => {
    for (const key of Object.keys(SYSTEM_SETTINGS_REGISTRY_OPERATIONS)) {
      expect(
        SYSTEM_SETTINGS_REGISTRY_OPERATIONS[key as keyof typeof SYSTEM_SETTINGS_REGISTRY_OPERATIONS]
          .key
      ).toBe(key);
    }
  });

  it('every entry is spread into the merged SYSTEM_SETTINGS_REGISTRY unchanged', () => {
    for (const key of Object.keys(SYSTEM_SETTINGS_REGISTRY_OPERATIONS)) {
      expect(SYSTEM_SETTINGS_REGISTRY[key as keyof typeof SYSTEM_SETTINGS_REGISTRY]).toEqual(
        SYSTEM_SETTINGS_REGISTRY_OPERATIONS[key as keyof typeof SYSTEM_SETTINGS_REGISTRY_OPERATIONS]
      );
    }
  });

  it('every entry belongs to the operations or memory-archive group', () => {
    for (const meta of Object.values(SYSTEM_SETTINGS_REGISTRY_OPERATIONS)) {
      expect(['operations', 'memory-archive']).toContain(meta.group);
    }
  });
});
