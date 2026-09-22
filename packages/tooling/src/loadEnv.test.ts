import { describe, it, expect, vi, afterEach } from 'vitest';

const configMock = vi.fn();

vi.mock('dotenv', () => ({
  config: configMock,
}));

describe('loadEnv', () => {
  afterEach(() => {
    vi.resetModules();
    configMock.mockClear();
  });

  it('calls dotenv config with quiet: true on import', async () => {
    await import('./loadEnv.js');

    expect(configMock).toHaveBeenCalledWith({ quiet: true });
  });
});
