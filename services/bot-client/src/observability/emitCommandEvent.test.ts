import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted: the logger mock's `warn` is read while `emitCommandEvent.ts` is
// evaluated (createLogger runs at module scope), which happens before a plain
// `const` in this file would be initialized.
const { mockRecordCommandEvent, mockWarn } = vi.hoisted(() => ({
  mockRecordCommandEvent: vi.fn(),
  mockWarn: vi.fn(),
}));

vi.mock('./recordCommandEvent.js', () => ({
  recordCommandEvent: (...args: unknown[]) => mockRecordCommandEvent(...args),
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

import { emitCommandEvent } from './emitCommandEvent.js';
import type { RecordCommandEventRequest } from './recordCommandEvent.js';

function makeEvent(): RecordCommandEventRequest {
  return {
    userId: '123456789012345678',
    channelKind: 'guild',
    command: 'character.create',
    outcome: 'ok',
    latencyMs: 10,
  };
}

describe('emitCommandEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('swallows an async rejection through the .catch (canary: removing it turns this red)', async () => {
    mockRecordCommandEvent.mockRejectedValue(new Error('gateway down'));

    expect(() => emitCommandEvent(makeEvent())).not.toThrow();
    // Let the rejection's microtask settle before asserting.
    await new Promise(resolve => setTimeout(resolve, 0));

    // Asserting the HANDLER RAN, not merely that the sync call didn't throw:
    // `emitCommandEvent` never awaits, so a not-toThrow assertion alone stays
    // green with the `.catch` deleted and would pin nothing. The warn is the
    // only observable proof the rejection was caught rather than escaping as
    // an unhandled rejection.
    expect(mockWarn).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'character.create' }),
      'Command event emission rejected'
    );
  });

  it('forwards the exact event to the underlying call', () => {
    mockRecordCommandEvent.mockResolvedValue(undefined);
    const event = makeEvent();

    emitCommandEvent(event);

    expect(mockRecordCommandEvent).toHaveBeenCalledWith(event);
  });
});
