import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockWarn } = vi.hoisted(() => ({ mockWarn: vi.fn() }));

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: mockWarn, error: vi.fn() }),
  };
});

import {
  runWithOutcomeSlot,
  noteRenderedOutcome,
  type CommandOutcomeSlot,
} from './commandOutcomeSlot.js';
import type { MessageSpec } from '../ux/catalog/types.js';

function makeSpec(overrides: Partial<MessageSpec> = {}): MessageSpec {
  return {
    severity: 'error',
    outcome: 'failed',
    text: 'something broke',
    ...overrides,
  };
}

describe('commandOutcomeSlot', () => {
  beforeEach(() => {
    mockWarn.mockClear();
  });

  it('is a silent no-op with no active store', () => {
    expect(() => noteRenderedOutcome(makeSpec())).not.toThrow();
  });

  it('sets outcome to user_error when a failed spec renders inside the run', async () => {
    const slot: CommandOutcomeSlot = {};
    await runWithOutcomeSlot(slot, async () => {
      noteRenderedOutcome(makeSpec({ outcome: 'failed' }));
    });
    expect(slot.outcome).toBe('user_error');
  });

  it('leaves the slot untouched for a non-failed outcome', async () => {
    const slot: CommandOutcomeSlot = {};
    await runWithOutcomeSlot(slot, async () => {
      noteRenderedOutcome(makeSpec({ severity: 'success', outcome: 'ok' }));
    });
    expect(slot.outcome).toBeUndefined();
  });

  it('maps an uncertain outcome to system_error with the uncertain_write code', async () => {
    const slot: CommandOutcomeSlot = {};
    await runWithOutcomeSlot(slot, async () => {
      noteRenderedOutcome(makeSpec({ outcome: 'uncertain' }));
    });
    expect(slot.outcome).toBe('system_error');
    expect(slot.errorCode).toBe('uncertain_write');
  });

  it('leaves committed-unconfirmed as ok — the operation applied', async () => {
    const slot: CommandOutcomeSlot = {};
    await runWithOutcomeSlot(slot, async () => {
      noteRenderedOutcome(makeSpec({ severity: 'success', outcome: 'committed-unconfirmed' }));
    });
    expect(slot.outcome).toBeUndefined();
  });

  it('survives an await boundary inside the run (the whole point of ALS)', async () => {
    const slot: CommandOutcomeSlot = {};
    await runWithOutcomeSlot(slot, async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
      noteRenderedOutcome(makeSpec({ outcome: 'failed' }));
    });
    expect(slot.outcome).toBe('user_error');
  });

  it('does not bleed between two concurrent runs', async () => {
    const slotA: CommandOutcomeSlot = {};
    const slotB: CommandOutcomeSlot = {};

    await Promise.all([
      runWithOutcomeSlot(slotA, async () => {
        // A zero-delay yield is enough to force the interleave this test is
        // about: A suspends here, B's synchronous callback runs to completion
        // inside its own store, and A then resumes in ITS store. A real delay
        // would add flake without adding interleaving.
        await new Promise(resolve => setTimeout(resolve, 0));
        noteRenderedOutcome(makeSpec({ outcome: 'failed' }));
      }),
      runWithOutcomeSlot(slotB, async () => {
        noteRenderedOutcome(makeSpec({ severity: 'success', outcome: 'ok' }));
      }),
    ]);

    expect(slotA.outcome).toBe('user_error');
    expect(slotB.outcome).toBeUndefined();
  });

  describe('second failed/uncertain note on one slot', () => {
    it('warns once on two failed notes and keeps the sticky write', async () => {
      const slot: CommandOutcomeSlot = {};
      await runWithOutcomeSlot(slot, async () => {
        noteRenderedOutcome(makeSpec({ outcome: 'failed' }));
        noteRenderedOutcome(makeSpec({ outcome: 'failed' }));
      });
      expect(mockWarn).toHaveBeenCalledTimes(1);
      expect(mockWarn).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: 'failed', previousOutcome: 'user_error' }),
        expect.any(String)
      );
      expect(slot.outcome).toBe('user_error');
    });

    it('warns once on a failed note followed by an uncertain note (last-wins)', async () => {
      const slot: CommandOutcomeSlot = {};
      await runWithOutcomeSlot(slot, async () => {
        noteRenderedOutcome(makeSpec({ outcome: 'failed' }));
        noteRenderedOutcome(makeSpec({ outcome: 'uncertain' }));
      });
      expect(mockWarn).toHaveBeenCalledTimes(1);
      expect(slot.outcome).toBe('system_error');
      expect(slot.errorCode).toBe('uncertain_write');
    });

    it('does not warn on a single failed note', async () => {
      await runWithOutcomeSlot({}, async () => {
        noteRenderedOutcome(makeSpec({ outcome: 'failed' }));
      });
      expect(mockWarn).not.toHaveBeenCalled();
    });

    it('does not warn for ok or committed-unconfirmed notes after a failed one', async () => {
      await runWithOutcomeSlot({}, async () => {
        noteRenderedOutcome(makeSpec({ outcome: 'failed' }));
        noteRenderedOutcome(makeSpec({ severity: 'success', outcome: 'ok' }));
        noteRenderedOutcome(makeSpec({ severity: 'success', outcome: 'committed-unconfirmed' }));
      });
      expect(mockWarn).not.toHaveBeenCalled();
    });

    it('does not warn across separate invocations (separate slots)', async () => {
      await runWithOutcomeSlot({}, async () => {
        noteRenderedOutcome(makeSpec({ outcome: 'failed' }));
      });
      await runWithOutcomeSlot({}, async () => {
        noteRenderedOutcome(makeSpec({ outcome: 'failed' }));
      });
      expect(mockWarn).not.toHaveBeenCalled();
    });
  });
});
