/**
 * Unit tests for customIdFamily.ts
 *
 * Uses a throwaway `demo` family covering every segment combinator to pin
 * `defineCustomIdFamily`'s build/parse/is semantics independent of any real
 * command's customId shape.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { defineCustomIdFamily, destructivePreset, seg } from './customIdFamily.js';
import { DestructiveCustomIds } from './customIds.js';

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

    it('throws when an action is named "caller" (strict-mode poison-pill accessor)', () => {
      expect(() => defineCustomIdFamily('ok', { caller: [] })).toThrow(/reserved/);
    });

    it('throws when an action is named "arguments" (same reason as "caller")', () => {
      expect(() => defineCustomIdFamily('ok', { arguments: [] })).toThrow(/reserved/);
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

describe('destructive preset', () => {
  describe('DestructiveCustomIds - all builders must use :: delimiter', () => {
    it('confirmButton with entityId', () => {
      const customId = DestructiveCustomIds.confirmButton('history', 'hard-delete', 'entity-123');
      expect(customId).toContain('::');
      expect(customId.startsWith('history::')).toBe(true);
    });
    it('confirmButton without entityId', () => {
      const customId = DestructiveCustomIds.confirmButton('history', 'hard-delete');
      expect(customId).toContain('::');
      expect(customId.startsWith('history::')).toBe(true);
    });
    it('cancelButton', () => {
      const customId = DestructiveCustomIds.cancelButton('history', 'hard-delete', 'entity-123');
      expect(customId).toContain('::');
      expect(customId.startsWith('history::')).toBe(true);
    });
    it('modalSubmit', () => {
      const customId = DestructiveCustomIds.modalSubmit('history', 'hard-delete', 'entity-123');
      expect(customId).toContain('::');
      expect(customId.startsWith('history::')).toBe(true);
    });
  });

  describe('builders', () => {
    it('should build confirmButton with entityId', () => {
      expect(
        DestructiveCustomIds.confirmButton('history', 'hard-delete', 'lilith_channel-123')
      ).toBe('history::destructive::confirm_button::hard-delete::lilith_channel-123');
    });
    it('should build confirmButton without entityId', () => {
      expect(DestructiveCustomIds.confirmButton('history', 'hard-delete')).toBe(
        'history::destructive::confirm_button::hard-delete'
      );
    });
    it('should build cancelButton with entityId', () => {
      expect(
        DestructiveCustomIds.cancelButton('history', 'hard-delete', 'lilith_channel-123')
      ).toBe('history::destructive::cancel_button::hard-delete::lilith_channel-123');
    });
    it('should build cancelButton without entityId', () => {
      expect(DestructiveCustomIds.cancelButton('history', 'hard-delete')).toBe(
        'history::destructive::cancel_button::hard-delete'
      );
    });
    it('should build modalSubmit with entityId', () => {
      expect(DestructiveCustomIds.modalSubmit('history', 'hard-delete', 'lilith_channel-123')).toBe(
        'history::destructive::modal_submit::hard-delete::lilith_channel-123'
      );
    });
    it('should build modalSubmit without entityId', () => {
      expect(DestructiveCustomIds.modalSubmit('history', 'hard-delete')).toBe(
        'history::destructive::modal_submit::hard-delete'
      );
    });
    it('should derive modalSubmit from a parsed button customId', () => {
      const parsed = DestructiveCustomIds.parse(
        DestructiveCustomIds.confirmButton('voice', 'voice-clear', 'all')
      );
      if (parsed === null) {
        throw new Error('expected parse to succeed');
      }
      expect(DestructiveCustomIds.modalSubmitFromParsed(parsed)).toBe(
        'voice::destructive::modal_submit::voice-clear::all'
      );
    });
    it('should derive modalSubmit from a parsed button customId without entityId', () => {
      const parsed = DestructiveCustomIds.parse(
        DestructiveCustomIds.confirmButton('history', 'hard-delete')
      );
      if (parsed === null) {
        throw new Error('expected parse to succeed');
      }
      expect(DestructiveCustomIds.modalSubmitFromParsed(parsed)).toBe(
        'history::destructive::modal_submit::hard-delete'
      );
    });
  });

  describe('parse', () => {
    it('should parse confirm_button action with entityId', () => {
      expect(
        DestructiveCustomIds.parse(
          'history::destructive::confirm_button::hard-delete::lilith_channel-123'
        )
      ).toEqual({
        source: 'history',
        action: 'confirm_button',
        operation: 'hard-delete',
        entityId: 'lilith_channel-123',
      });
    });
    it('should parse cancel_button action', () => {
      expect(
        DestructiveCustomIds.parse('history::destructive::cancel_button::hard-delete::entity-123')
      ).toEqual({
        source: 'history',
        action: 'cancel_button',
        operation: 'hard-delete',
        entityId: 'entity-123',
      });
    });
    it('should parse modal_submit action', () => {
      expect(
        DestructiveCustomIds.parse('history::destructive::modal_submit::hard-delete::entity-123')
      ).toEqual({
        source: 'history',
        action: 'modal_submit',
        operation: 'hard-delete',
        entityId: 'entity-123',
      });
    });
    it('should parse without entityId', () => {
      expect(
        DestructiveCustomIds.parse('history::destructive::confirm_button::hard-delete')
      ).toEqual({
        source: 'history',
        action: 'confirm_button',
        operation: 'hard-delete',
        entityId: undefined,
      });
    });
    it('should return null for non-destructive customId', () => {
      expect(DestructiveCustomIds.parse('character::seed')).toBeNull();
    });
    it('should return null for malformed destructive customId (too short)', () => {
      expect(DestructiveCustomIds.parse('history::destructive::confirm')).toBeNull();
    });
    it('returns null for fewer than four segments', () => {
      expect(DestructiveCustomIds.parse('history::destructive::confirm_button')).toBeNull();
    });
    it('returns null when the second segment is not "destructive"', () => {
      expect(DestructiveCustomIds.parse('history::other::confirm_button::op')).toBeNull();
    });
    it('returns null for a step outside the enum (closes the old cast-through bug)', () => {
      expect(DestructiveCustomIds.parse('history::destructive::explode_button::op')).toBeNull();
    });
    it('returns null for an empty operation', () => {
      expect(DestructiveCustomIds.parse('history::destructive::confirm_button::')).toBeNull();
    });
    it('returns null for extra segments past entityId', () => {
      expect(
        DestructiveCustomIds.parse('history::destructive::confirm_button::op::e1::extra')
      ).toBeNull();
    });
    it('parses a fresh, never-before-built source', () => {
      expect(DestructiveCustomIds.parse('freshsource::destructive::confirm_button::op')).toEqual({
        source: 'freshsource',
        action: 'confirm_button',
        operation: 'op',
      });
    });
  });

  describe('isDestructive', () => {
    it('should return true for destructive customIds', () => {
      expect(
        DestructiveCustomIds.isDestructive(
          'history::destructive::confirm_button::hard-delete::entity'
        )
      ).toBe(true);
    });
    it('should return true regardless of source command', () => {
      expect(
        DestructiveCustomIds.isDestructive('character::destructive::confirm_button::delete')
      ).toBe(true);
    });
    it('should return false for non-destructive customIds', () => {
      expect(DestructiveCustomIds.isDestructive('character::seed')).toBe(false);
      expect(DestructiveCustomIds.isDestructive('persona::create')).toBe(false);
    });
    it('agrees with parse on an empty source: not destructive, and parse returns null', () => {
      expect(DestructiveCustomIds.isDestructive('::destructive::confirm_button::op')).toBe(false);
      expect(DestructiveCustomIds.parse('::destructive::confirm_button::op')).toBeNull();
    });
    it('returns false when "destructive" appears at a non-second position', () => {
      expect(DestructiveCustomIds.isDestructive('history::other::destructive::op')).toBe(false);
    });
    it('returns true positionally', () => {
      expect(DestructiveCustomIds.isDestructive('history::destructive::confirm_button::op')).toBe(
        true
      );
    });
  });

  it('direct composition: destructivePreset spread into a family action map builds and parses', () => {
    const family = defineCustomIdFamily('demo', { ...destructivePreset() });
    const customId = family.build.destructive('cancel_button', 'op', 'e1');
    expect(customId).toBe('demo::destructive::cancel_button::op::e1');
    expect(family.parse(customId)).toEqual({
      action: 'destructive',
      step: 'cancel_button',
      operation: 'op',
      entityId: 'e1',
    });
  });

  it('cap throw: names the action label and the actual/max length', () => {
    expect(() =>
      DestructiveCustomIds.confirmButton('history', 'history-purge', 'x'.repeat(90))
    ).toThrow(/history::destructive is \d+ chars \(max 100\)/);
  });

  it('empty operation throws a non-empty-value error at build', () => {
    expect(() => DestructiveCustomIds.confirmButton('history', '')).toThrow(/non-empty/);
  });
});
