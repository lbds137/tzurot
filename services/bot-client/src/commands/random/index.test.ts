/**
 * Tests for /random (top-level random-character chat command surface)
 *
 * The turn logic itself is covered by services/character/characterTurn.test.ts;
 * this file pins the command wiring: definition shape and delegation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SafeCommandContext } from '../../utils/commandContext/types.js';

vi.mock('../../services/character/characterTurn.js', () => ({
  handleRandom: vi.fn().mockResolvedValue(undefined),
}));

import randomCommand from './index.js';
import { handleRandom } from '../../services/character/characterTurn.js';

describe('/random command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('command definition', () => {
    it('is named random and defers ephemerally', () => {
      expect(randomCommand.data.name).toBe('random');
      expect(randomCommand.deferralMode).toBe('ephemeral');
    });

    it('has every option optional (bare /random reads the room)', () => {
      const json = randomCommand.data.toJSON();
      const names = json.options?.map(opt => opt.name).sort();
      expect(names).toEqual(['exclude-private', 'incognito', 'message', 'only-mine']);
      expect(json.options?.every(opt => opt.required !== true)).toBe(true);
    });
  });

  describe('execute', () => {
    it('delegates to the character-turn engine', async () => {
      const context = { interaction: {} } as unknown as SafeCommandContext;
      await randomCommand.execute(context);
      expect(handleRandom).toHaveBeenCalledWith(context);
    });
  });
});
