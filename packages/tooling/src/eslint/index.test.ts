import { describe, it, expect } from 'vitest';
import plugin from './index.js';

describe('ESLint plugin', () => {
  it('should export a valid plugin object', () => {
    expect(plugin).toBeDefined();
    expect(plugin.meta).toBeDefined();
    expect(plugin.rules).toBeDefined();
  });

  it('should have correct meta information', () => {
    expect(plugin.meta?.name).toBe('@tzurot/eslint-plugin');
    expect(plugin.meta?.version).toBe('1.0.0');
  });

  it('should export no-singleton-export rule', () => {
    expect(plugin.rules?.['no-singleton-export']).toBeDefined();
  });

  it('rule should have correct structure', () => {
    const rule = plugin.rules?.['no-singleton-export'];
    expect(rule?.meta).toBeDefined();
    expect(rule?.create).toBeDefined();
    expect(typeof rule?.create).toBe('function');
  });
});
