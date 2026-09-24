/**
 * Unit tests for customIdFamily.ts
 *
 * Uses a throwaway `demo` family covering every segment combinator to pin
 * `defineCustomIdFamily`'s build/parse/is semantics independent of any real
 * command's customId shape.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { defineCustomIdFamily, seg } from './customIdFamily.js';

const { loggerMock } = vi.hoisted(() => ({
  loggerMock: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => loggerMock,
  };
});

const demo = defineCustomIdFamily('demo', {
  str: [seg.str('name')],
  int: [seg.int('page')],
  enumAction: [seg.enum('sort', ['date', 'name'] as const)],
  codecAction: [seg.codec('value', { encode: (v: string) => v, decode: (raw: string) => raw })],
  optTrailing: [seg.str('id'), seg.optional(seg.str('section'))],
  create: [],
});

describe('defineCustomIdFamily', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('build — one call per combinator kind', () => {
    it('builds a str segment', () => {
      expect(demo.build.str('hello')).toBe('demo::str::hello');
    });

    it('builds an int segment, including negatives', () => {
      expect(demo.build.int(3)).toBe('demo::int::3');
      expect(demo.build.int(-1)).toBe('demo::int::-1');
    });

    it('builds an enum segment', () => {
      expect(demo.build.enumAction('date')).toBe('demo::enumAction::date');
    });

    it('builds a codec segment', () => {
      expect(demo.build.codecAction('x')).toBe('demo::codecAction::x');
    });

    it('builds with a zero-arg action', () => {
      expect(demo.build.create()).toBe('demo::create');
    });

    it('builds an optional trailing segment when present', () => {
      expect(demo.build.optTrailing('id1', 'sec1')).toBe('demo::optTrailing::id1::sec1');
    });

    it('builds an optional trailing segment when absent', () => {
      expect(demo.build.optTrailing('id1')).toBe('demo::optTrailing::id1');
    });
  });

  describe('define-time throws', () => {
    it('throws when a required segment follows an optional one', () => {
      expect(() =>
        defineCustomIdFamily('bad', {
          action: [seg.optional(seg.str('a')), seg.str('b')],
        })
      ).toThrow(/required segment/);
    });

    it('throws on a duplicate segment name within an action', () => {
      expect(() =>
        defineCustomIdFamily('bad', {
          action: [seg.str('a'), seg.str('a')],
        })
      ).toThrow(/duplicate segment name/);
    });

    it('throws when a segment is named "action" (would clobber the discriminant)', () => {
      expect(() => defineCustomIdFamily('bad', { x: [seg.str('action')] })).toThrow(
        /reserved segment name/
      );
    });

    it('throws when a segment is named "__proto__" (bracket assignment hits the inherited setter)', () => {
      expect(() => defineCustomIdFamily('bad', { x: [seg.str('__proto__')] })).toThrow(
        /reserved segment name/
      );
    });

    it('throws when the prefix contains ::', () => {
      expect(() => defineCustomIdFamily('ba::d', { action: [] })).toThrow(/must not contain/);
    });

    it('throws when an action name contains ::', () => {
      expect(() => defineCustomIdFamily('ok', { 'ba::d': [] })).toThrow(/must not contain/);
    });

    it('throws when an action is named "name" (Object.assign in buildIsFn cannot overwrite it)', () => {
      expect(() => defineCustomIdFamily('ok', { name: [] })).toThrow(/reserved/);
    });

    it('throws when an action is named "length" (same reason as "name")', () => {
      expect(() => defineCustomIdFamily('ok', { length: [] })).toThrow(/reserved/);
    });

    it('throws when a computed "__proto__" action would hit the inherited setter', () => {
      expect(() => defineCustomIdFamily('ok', { ['__proto__']: [] })).toThrow(/reserved/);
    });

    it('does NOT throw for "constructor"/"toString" action names, and `is.<action>` works', () => {
      const family = defineCustomIdFamily('ok', { constructor: [], toString: [] });
      expect(family.is.constructor('ok::constructor')).toBe(true);
    });
  });

  describe('build-time throws', () => {
    it('throws when a required arg is undefined', () => {
      expect(() => demo.build.str(undefined as unknown as string)).toThrow(
        /missing required segment/
      );
    });

    it('throws when a later arg is supplied after skipping an earlier optional one', () => {
      const family = defineCustomIdFamily('gap', {
        action: [seg.optional(seg.str('a')), seg.optional(seg.str('b'))],
      });
      expect(() => family.build.action(undefined as unknown as string, 'b-value')).toThrow(
        /cannot supply segment "b"/
      );
    });

    it('throws naming the action and segment when a value contains the delimiter', () => {
      expect(() => demo.build.str('a::b')).toThrow(/demo::str/);
      expect(() => demo.build.str('a::b')).toThrow(/segment "name"/);
    });

    it('throws naming the action and the actual length when the customId exceeds the limit', () => {
      const longValue = 'x'.repeat(95);
      expect(() => demo.build.str(longValue)).toThrow(/demo::str is \d+ chars \(max 100\)/);
    });

    it('throws when a non-terminal segment value ends with ":" (would merge with the delimiter)', () => {
      const colonFamily = defineCustomIdFamily('colon', {
        pair: [seg.str('a'), seg.str('b')],
      });
      expect(() => colonFamily.build.pair('x:', 'y')).toThrow(/non-terminal/);
    });

    it('round-trips a leading colon on a non-terminal segment', () => {
      const colonFamily = defineCustomIdFamily('colon', {
        pair: [seg.str('a'), seg.str('b')],
      });
      const customId = colonFamily.build.pair(':y', 'z');
      expect(customId).toBe('colon::pair::' + ':y' + '::z');
      expect(colonFamily.parse(customId)).toEqual({ action: 'pair', a: ':y', b: 'z' });
    });

    it('round-trips an interior colon on a non-terminal segment', () => {
      const colonFamily = defineCustomIdFamily('colon', {
        pair: [seg.str('a'), seg.str('b')],
      });
      const customId = colonFamily.build.pair('x:y', 'z');
      expect(colonFamily.parse(customId)).toEqual({ action: 'pair', a: 'x:y', b: 'z' });
    });

    it('round-trips a trailing colon on the LAST segment (not rejected there)', () => {
      const colonFamily = defineCustomIdFamily('colon', {
        pair: [seg.str('a'), seg.str('b')],
      });
      const customId = colonFamily.build.pair('x', 'y:');
      expect(customId).toBe('colon::pair::x::y:');
      expect(colonFamily.parse(customId)).toEqual({ action: 'pair', a: 'x', b: 'y:' });
    });

    it('accepts a trailing colon on the last-ENCODED segment when a trailing optional is omitted', () => {
      const customId = demo.build.optTrailing('id1:');
      expect(customId).toBe('demo::optTrailing::id1:');
      expect(demo.parse(customId)).toEqual({ action: 'optTrailing', id: 'id1:' });
    });

    it('still rejects a trailing colon on a non-terminal segment when the optional IS supplied', () => {
      expect(() => demo.build.optTrailing('id1:', 'sec')).toThrow(/non-terminal/);
    });
  });

  describe('parse — happy paths', () => {
    it('parses a str action', () => {
      expect(demo.parse('demo::str::hello')).toEqual({ action: 'str', name: 'hello' });
    });

    it('parses an int action, including a negative value', () => {
      expect(demo.parse('demo::int::-1')).toEqual({ action: 'int', page: -1 });
    });

    it('parses an enum action', () => {
      expect(demo.parse('demo::enumAction::date')).toEqual({ action: 'enumAction', sort: 'date' });
    });

    it('parses a codec action', () => {
      expect(demo.parse('demo::codecAction::x')).toEqual({ action: 'codecAction', value: 'x' });
    });

    it('parses a zero-arg action', () => {
      expect(demo.parse('demo::create')).toEqual({ action: 'create' });
    });

    it('parses an optional trailing segment when present', () => {
      expect(demo.parse('demo::optTrailing::id1::sec1')).toEqual({
        action: 'optTrailing',
        id: 'id1',
        section: 'sec1',
      });
    });

    it('parses an optional trailing segment when absent — key is absent', () => {
      const result = demo.parse('demo::optTrailing::id1');
      expect(result).toEqual({ action: 'optTrailing', id: 'id1' });
      expect(Object.hasOwn(result ?? {}, 'section')).toBe(false);
    });

    it('parses a decoded `null` as a valid value, not a rejection — key is present', () => {
      const nullFamily = defineCustomIdFamily('nul', {
        action: [seg.codec('v', { encode: (v: string | null) => v ?? '', decode: () => null })],
      });
      const result = nullFamily.parse('nul::action::anything');
      expect(result).toEqual({ action: 'action', v: null });
      expect(Object.hasOwn(result ?? {}, 'v')).toBe(true);
    });
  });

  describe('parse — rejects', () => {
    it('rejects the wrong prefix', () => {
      expect(demo.parse('other::str::hello')).toBeNull();
    });

    it('rejects the bare prefix alone', () => {
      expect(demo.parse('demo::')).toBeNull();
    });

    it('rejects an unknown action', () => {
      expect(demo.parse('demo::nope::x')).toBeNull();
    });

    it('rejects when a required segment is missing', () => {
      expect(demo.parse('demo::str')).toBeNull();
    });

    it('rejects when there are extra segments', () => {
      expect(demo.parse('demo::str::hello::extra')).toBeNull();
      expect(demo.parse('demo::create::extra')).toBeNull();
    });

    it('rejects a non-integer value for an int segment', () => {
      expect(demo.parse('demo::int::3abc')).toBeNull();
    });

    it('rejects an int segment value outside Number.isSafeInteger (imprecise as a float)', () => {
      expect(demo.parse('demo::int::99999999999999999999')).toBeNull();
    });

    it('accepts a negative integer for an int segment', () => {
      expect(demo.parse('demo::int::-1')).toEqual({ action: 'int', page: -1 });
    });

    it('rejects a value outside the declared enum', () => {
      expect(demo.parse('demo::enumAction::nope')).toBeNull();
    });

    it('rejects when the codec decode returns undefined', () => {
      const withRejecting = defineCustomIdFamily('rej', {
        action: [seg.codec('v', { encode: (v: string) => v, decode: () => undefined })],
      });
      expect(withRejecting.parse('rej::action::anything')).toBeNull();
    });

    it('rejects (without throwing) when the codec decode itself throws, and logs a warning', () => {
      const withThrowingDecode = defineCustomIdFamily('rej', {
        action: [
          seg.codec('v', {
            encode: (v: string) => v,
            decode: () => {
              throw new Error('malformed');
            },
          }),
        ],
      });
      expect(() => withThrowingDecode.parse('rej::action::x')).not.toThrow();
      expect(withThrowingDecode.parse('rej::action::x')).toBeNull();
      expect(loggerMock.warn).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'action', segment: 'v' }),
        'customId segment decode threw'
      );
    });

    it('protects against Object.prototype-shaped action names', () => {
      expect(demo.parse('demo::constructor')).toBeNull();
      expect(demo.parse('demo::toString::x')).toBeNull();
    });
  });

  describe('is', () => {
    it('is(id) matches any action under the prefix', () => {
      expect(demo.is('demo::str::hello')).toBe(true);
      expect(demo.is('demo::create')).toBe(true);
      expect(demo.is('other::str::hello')).toBe(false);
    });

    it('is.<action>(id) matches the exact zero-segment form', () => {
      expect(demo.is.create('demo::create')).toBe(true);
      expect(demo.is.create('demo::create::extra')).toBe(true);
      expect(demo.is.create('demo::createx')).toBe(false);
    });

    it('is.<action>(id) matches the prefixed form and rejects other actions', () => {
      expect(demo.is.str('demo::str::hello')).toBe(true);
      expect(demo.is.str('demo::int::3')).toBe(false);
    });
  });

  describe('prefix', () => {
    it('exposes the declared prefix', () => {
      expect(demo.prefix).toBe('demo');
    });
  });
});
