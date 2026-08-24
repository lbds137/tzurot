import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRecordCommandEvent, mockWarn } = vi.hoisted(() => ({
  mockRecordCommandEvent: vi.fn(),
  mockWarn: vi.fn(),
}));

vi.mock('../utils/gatewayClients.js', () => ({
  getServiceClient: () => ({ recordCommandEvent: mockRecordCommandEvent }),
}));

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: mockWarn, error: vi.fn() }),
  };
});

import { recordCommandEvent, type RecordCommandEventRequest } from './recordCommandEvent.js';

function makeEvent(): RecordCommandEventRequest {
  return {
    userId: '123456789012345678',
    guildId: '987654321098765432',
    channelKind: 'guild',
    command: 'character.create',
    outcome: 'ok',
    latencyMs: 42,
  };
}

describe('recordCommandEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forwards the exact event body across the client seam', async () => {
    mockRecordCommandEvent.mockResolvedValue({ ok: true, data: { recorded: true } });
    const event = makeEvent();

    await recordCommandEvent(event);

    expect(mockRecordCommandEvent).toHaveBeenCalledWith(event);
  });

  it('resolves (never rejects) when the gateway reports a failure', async () => {
    mockRecordCommandEvent.mockResolvedValue({
      ok: false,
      kind: 'http',
      status: 500,
      error: 'boom',
    });

    await expect(recordCommandEvent(makeEvent())).resolves.toBeUndefined();
  });

  it('logs the command and status on failure, and never the user or guild id', async () => {
    mockRecordCommandEvent.mockResolvedValue({
      ok: false,
      kind: 'http',
      status: 500,
      error: 'boom',
    });

    await recordCommandEvent(makeEvent());

    expect(mockWarn).toHaveBeenCalledWith(
      { command: 'character.create', status: 500 },
      'Failed to record command event'
    );
    // Exact-object assertion above already excludes them; asserted explicitly
    // because "no identifiers in the telemetry failure log" is the property,
    // not an incidental shape.
    const [fields] = mockWarn.mock.calls[0] as [Record<string, unknown>];
    expect(fields).not.toHaveProperty('userId');
    expect(fields).not.toHaveProperty('guildId');
  });

  it('logs nothing on success', async () => {
    mockRecordCommandEvent.mockResolvedValue({ ok: true, data: { recorded: true } });

    await recordCommandEvent(makeEvent());

    expect(mockWarn).not.toHaveBeenCalled();
  });
});
