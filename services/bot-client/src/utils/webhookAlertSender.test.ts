import { describe, expect, it, vi } from 'vitest';
import { WEBHOOK_ALERT_TIMEOUT_MS, createWebhookAlertSender } from './webhookAlertSender.js';

const WEBHOOK_URL = 'https://discord.com/api/webhooks/1/abc';

describe('WEBHOOK_ALERT_TIMEOUT_MS', () => {
  it('is 2.5s — the alert must not meaningfully delay its caller recovery', () => {
    expect(WEBHOOK_ALERT_TIMEOUT_MS).toBe(2500);
  });
});

describe('createWebhookAlertSender', () => {
  const buildLogger = (): { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> } => ({
    info: vi.fn(),
    warn: vi.fn(),
  });

  it('POSTs { content } JSON with the auth-free webhook headers and an abort signal', async () => {
    const logger = buildLogger();
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    const send = createWebhookAlertSender(
      logger as unknown as Parameters<typeof createWebhookAlertSender>[0],
      WEBHOOK_URL,
      {
        fetchFn: fetchMock as unknown as typeof fetch,
      }
    );

    await send('alert body');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(WEBHOOK_URL);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ content: 'alert body' });
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('never calls fetch when no webhook URL is configured', async () => {
    const logger = buildLogger();
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    const send = createWebhookAlertSender(
      logger as unknown as Parameters<typeof createWebhookAlertSender>[0],
      undefined,
      {
        fetchFn: fetchMock as unknown as typeof fetch,
      }
    );

    await send('ignored');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never calls fetch when the webhook URL is blank', async () => {
    const logger = buildLogger();
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    const send = createWebhookAlertSender(
      logger as unknown as Parameters<typeof createWebhookAlertSender>[0],
      '   ',
      {
        fetchFn: fetchMock as unknown as typeof fetch,
      }
    );

    await send('ignored');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('warns on a non-OK response (dead webhook is not a delivered alert) and resolves anyway', async () => {
    const logger = buildLogger();
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 404 })));
    const send = createWebhookAlertSender(
      logger as unknown as Parameters<typeof createWebhookAlertSender>[0],
      WEBHOOK_URL,
      {
        fetchFn: fetchMock as unknown as typeof fetch,
        source: 'gateway-watchdog',
      }
    );

    await expect(send('alert body')).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(
      { source: 'gateway-watchdog', status: 404 },
      expect.stringContaining('non-OK')
    );
  });

  it('defaults the source field to unknown when the caller passes none', async () => {
    const logger = buildLogger();
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 500 })));
    const send = createWebhookAlertSender(
      logger as unknown as Parameters<typeof createWebhookAlertSender>[0],
      WEBHOOK_URL,
      {
        fetchFn: fetchMock as unknown as typeof fetch,
      }
    );

    await send('alert body');

    expect(logger.warn).toHaveBeenCalledWith(
      { source: 'unknown', status: 500 },
      expect.stringContaining('non-OK')
    );
  });

  it('resolves when the fetch rejects — a failed alert cannot break the caller', async () => {
    const logger = buildLogger();
    const fetchMock = vi.fn(() => Promise.reject(new Error('network down')));
    const send = createWebhookAlertSender(
      logger as unknown as Parameters<typeof createWebhookAlertSender>[0],
      WEBHOOK_URL,
      {
        fetchFn: fetchMock as unknown as typeof fetch,
        source: 'gateway-watchdog',
      }
    );

    await expect(send('alert body')).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'gateway-watchdog' }),
      expect.stringContaining('POST failed')
    );
  });

  it('resolves when the fetch function throws synchronously', async () => {
    const logger = buildLogger();
    const fetchMock = vi.fn(() => {
      throw new Error('boom');
    });
    const send = createWebhookAlertSender(
      logger as unknown as Parameters<typeof createWebhookAlertSender>[0],
      WEBHOOK_URL,
      {
        fetchFn: fetchMock as unknown as typeof fetch,
      }
    );

    await expect(send('alert body')).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});
