import { describe, it, expect } from 'vitest';

describe('tooling package exports', () => {
  it('should export registerDbCommands', async () => {
    const module = await import('./index.js');
    expect(module.registerDbCommands).toBeDefined();
    expect(typeof module.registerDbCommands).toBe('function');
  });

  it('should export registerDataCommands', async () => {
    const module = await import('./index.js');
    expect(module.registerDataCommands).toBeDefined();
    expect(typeof module.registerDataCommands).toBe('function');
  });

  it('should export registerDeployCommands', async () => {
    const module = await import('./index.js');
    expect(module.registerDeployCommands).toBeDefined();
    expect(typeof module.registerDeployCommands).toBe('function');
  });
});
