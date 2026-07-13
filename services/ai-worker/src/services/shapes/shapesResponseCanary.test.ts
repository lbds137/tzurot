/**
 * Tests for the shapes.inc schema-drift canary.
 *
 * The load-bearing property is OBSERVE-ONLY: the canary warns on drift and
 * never throws, no matter how mangled the payload — a drifted export must
 * still complete with whatever data the API returned.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const warnSpy = vi.hoisted(() => vi.fn());

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: warnSpy,
      error: vi.fn(),
    }),
  };
});

import { observeShapesResponseShape } from './shapesResponseCanary.js';

const COMPLETE_CONFIG = {
  id: 'shape-1',
  name: 'Test',
  username: 'test',
  avatar: 'https://example.test/a.png',
  jailbreak: 'jb',
  user_prompt: 'up',
  personality_traits: 'traits',
  engine_model: 'model-x',
  engine_temperature: 0.7,
  stm_window: 10,
  ltm_enabled: true,
  ltm_threshold: 0.5,
  ltm_max_retrieved_summaries: 5,
};

beforeEach(() => {
  warnSpy.mockClear();
});

describe('observeShapesResponseShape', () => {
  describe('config', () => {
    it('stays silent on a complete config', () => {
      observeShapesResponseShape('config', COMPLETE_CONFIG);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('warns with the missing field names when required fields are absent', () => {
      const { jailbreak: _jb, engine_model: _em, ...drifted } = COMPLETE_CONFIG;
      observeShapesResponseShape('config', drifted);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: 'config',
          detail: { missing: ['jailbreak', 'engine_model'] },
        }),
        expect.stringContaining('drifted')
      );
    });

    it('warns (and does not throw) on a non-object payload', () => {
      expect(() => observeShapesResponseShape('config', 'not json at all')).not.toThrow();
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('memoryPage', () => {
    it('stays silent when items + pagination are present', () => {
      observeShapesResponseShape('memoryPage', { items: [], pagination: { has_next: false } });
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("accepts the legacy 'memories' array key", () => {
      observeShapesResponseShape('memoryPage', { memories: [], pagination: {} });
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('warns when neither items nor memories is an array', () => {
      observeShapesResponseShape('memoryPage', { pagination: {} });
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it('warns when pagination is missing (traversal may stop early)', () => {
      observeShapesResponseShape('memoryPage', { items: [] });
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('stories', () => {
    it('accepts a bare array', () => {
      observeShapesResponseShape('stories', []);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('accepts an object with an items array', () => {
      observeShapesResponseShape('stories', { items: [] });
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('warns on an unrecognizable shape', () => {
      observeShapesResponseShape('stories', { items: 'nope' });
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('userPersonalization', () => {
    it('accepts any object', () => {
      observeShapesResponseShape('userPersonalization', {});
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('warns on a non-object', () => {
      observeShapesResponseShape('userPersonalization', 42);
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });
  });

  it('never throws on adversarial payloads (observe-only invariant)', () => {
    const garbage: unknown[] = [null, undefined, 0, '', [], () => {}, Symbol('x')];
    for (const kind of ['config', 'memoryPage', 'stories', 'userPersonalization'] as const) {
      for (const payload of garbage) {
        expect(() => observeShapesResponseShape(kind, payload)).not.toThrow();
      }
    }
  });
});
