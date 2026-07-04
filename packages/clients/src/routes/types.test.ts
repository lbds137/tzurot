/**
 * Tests for the branded ActorDiscordId / SubjectDiscordId types and their
 * smart constructors.
 *
 * The brands are nominal types — at runtime they're just strings. These tests
 * cover the runtime contract (constructors return the input string verbatim,
 * preserve equality semantics) and document the type-level contract via
 * type-only assertions that fail at compile time if the brands erode.
 */

import { describe, it, expect, expectTypeOf } from 'vitest';
import { z } from 'zod';
import { asActor, asSubject, resolveQueryShape } from './types.js';
import type { ActorDiscordId, SubjectDiscordId } from './types.js';

describe('asActor', () => {
  it('returns the input string verbatim at runtime', () => {
    const id = asActor('123456789012345678');
    expect(id).toBe('123456789012345678');
  });

  it('preserves string equality between two branded instances of the same id', () => {
    const a = asActor('111');
    const b = asActor('111');
    expect(a).toBe(b);
  });

  it('produces a value assignable to ActorDiscordId at the type level', () => {
    const id = asActor('999');
    expectTypeOf(id).toEqualTypeOf<ActorDiscordId>();
  });

  it('throws with a descriptive message on an empty string id', () => {
    expect(() => asActor('')).toThrow('asActor: id must be non-empty');
  });
});

describe('asSubject', () => {
  it('returns the input string verbatim at runtime', () => {
    const id = asSubject('987654321098765432');
    expect(id).toBe('987654321098765432');
  });

  it('produces a value assignable to SubjectDiscordId at the type level', () => {
    const id = asSubject('222');
    expectTypeOf(id).toEqualTypeOf<SubjectDiscordId>();
  });

  it('throws with a descriptive message on an empty string id', () => {
    expect(() => asSubject('')).toThrow('asSubject: id must be non-empty');
  });
});

describe('brand distinctness', () => {
  it('ActorDiscordId is not assignable to SubjectDiscordId (type-level)', () => {
    const actor = asActor('111');
    // @ts-expect-error — ActorDiscordId and SubjectDiscordId are nominally distinct
    const subject: SubjectDiscordId = actor;
    // Suppress unused-variable lint by referencing
    expect(subject).toBeDefined();
  });

  it('SubjectDiscordId is not assignable to ActorDiscordId (type-level)', () => {
    const subject = asSubject('222');
    // @ts-expect-error — SubjectDiscordId and ActorDiscordId are nominally distinct
    const actor: ActorDiscordId = subject;
    expect(actor).toBeDefined();
  });

  it('raw string is not assignable to ActorDiscordId without the constructor', () => {
    // @ts-expect-error — must use asActor() to mint the brand
    const actor: ActorDiscordId = 'raw-string';
    expect(actor).toBeDefined();
  });

  it('raw string is not assignable to SubjectDiscordId without the constructor', () => {
    // @ts-expect-error — must use asSubject() to mint the brand
    const subject: SubjectDiscordId = 'raw-string';
    expect(subject).toBeDefined();
  });

  it('ActorDiscordId IS assignable to string (one-way: brand → underlying)', () => {
    const actor = asActor('111');
    // The brand is a string intersection — actors ARE strings at the type level.
    // This direction is intentional so generated client URL templates can
    // concatenate the actor into a header value without ceremony.
    const raw: string = actor;
    expect(raw).toBe('111');
  });
});

describe('resolveQueryShape', () => {
  it('returns undefined when query is undefined', () => {
    expect(resolveQueryShape(undefined)).toBeUndefined();
  });

  it('returns the Record verbatim when query is a Record', () => {
    const record = { foo: z.string(), bar: z.number().optional() };
    expect(resolveQueryShape(record)).toBe(record);
  });

  it('unwraps a ZodObject to its shape', () => {
    const schema = z.object({ foo: z.string(), bar: z.number().optional() });
    const shape = resolveQueryShape(schema);
    expect(shape).toBeDefined();
    expect(Object.keys(shape ?? {}).sort()).toEqual(['bar', 'foo']);
  });

  it('produces a shape suitable for `Object.keys()` iteration', () => {
    // The codegen calls Object.keys(shape) to emit query param names.
    // Both forms must produce iterable keys.
    const recordShape = resolveQueryShape({ a: z.string() });
    const objectShape = resolveQueryShape(z.object({ a: z.string() }));
    expect(Object.keys(recordShape ?? {})).toEqual(['a']);
    expect(Object.keys(objectShape ?? {})).toEqual(['a']);
  });
});
