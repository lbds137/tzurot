/**
 * Tests for Voice Engine Warm-Up
 *
 * Verifies the shared health-polling loop used by both TTS and STT paths
 * to handle Railway Serverless cold starts (~56s).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  };
});

const { waitForVoiceEngine } = await import('./voiceEngineWarmup.js');

function createMockClient(getHealthImpl: () => Promise<{ asr: boolean; tts: boolean }>) {
  return { getHealth: vi.fn(getHealthImpl) } as unknown as Parameters<typeof waitForVoiceEngine>[0];
}

describe('waitForVoiceEngine', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns true immediately when capability is ready on first poll', async () => {
    const client = createMockClient(async () => ({ asr: true, tts: true }));

    const promise = waitForVoiceEngine(client, 'tts');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe(true);
    expect(client.getHealth).toHaveBeenCalledTimes(1);
  });

  it('polls until ready (simulates cold start)', async () => {
    const client = createMockClient(
      vi
        .fn<() => Promise<{ asr: boolean; tts: boolean }>>()
        .mockResolvedValueOnce({ asr: false, tts: false })
        .mockResolvedValueOnce({ asr: false, tts: false })
        .mockResolvedValueOnce({ asr: true, tts: true })
    );

    const promise = waitForVoiceEngine(client, 'tts');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe(true);
    expect(client.getHealth).toHaveBeenCalledTimes(3);
  });

  it('returns false when budget exhausted (all polls unhealthy)', async () => {
    const client = createMockClient(async () => ({ asr: false, tts: false }));

    const promise = waitForVoiceEngine(client, 'tts', {
      budgetMs: 9_000,
      pollIntervalMs: 3_000,
    });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe(false);
    // 9_000 / 3_000 = 3 polls (each followed by 3s sleep)
    expect(client.getHealth).toHaveBeenCalledTimes(3);
  });

  it('respects custom budgetMs and pollIntervalMs', async () => {
    const client = createMockClient(async () => ({ asr: false, tts: false }));

    const promise = waitForVoiceEngine(client, 'asr', {
      budgetMs: 5_000,
      pollIntervalMs: 1_000,
    });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe(false);
    // 5_000 / 1_000 = 5 polls
    expect(client.getHealth).toHaveBeenCalledTimes(5);
  });

  it('checks correct capability field — asr', async () => {
    // TTS ready but ASR not — should keep polling for ASR
    const client = createMockClient(
      vi
        .fn<() => Promise<{ asr: boolean; tts: boolean }>>()
        .mockResolvedValueOnce({ asr: false, tts: true })
        .mockResolvedValueOnce({ asr: true, tts: true })
    );

    const promise = waitForVoiceEngine(client, 'asr');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe(true);
    expect(client.getHealth).toHaveBeenCalledTimes(2);
  });

  it('checks correct capability field — tts', async () => {
    // ASR ready but TTS not — should keep polling for TTS
    const client = createMockClient(
      vi
        .fn<() => Promise<{ asr: boolean; tts: boolean }>>()
        .mockResolvedValueOnce({ asr: true, tts: false })
        .mockResolvedValueOnce({ asr: true, tts: true })
    );

    const promise = waitForVoiceEngine(client, 'tts');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe(true);
    expect(client.getHealth).toHaveBeenCalledTimes(2);
  });

  it('uses default budget and interval when no options provided', async () => {
    const client = createMockClient(async () => ({ asr: false, tts: false }));

    const promise = waitForVoiceEngine(client, 'tts');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe(false);
    // Default: 75_000 / 3_000 = 25 polls
    expect(client.getHealth).toHaveBeenCalledTimes(25);
  });
});
