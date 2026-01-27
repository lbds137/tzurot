/**
 * Tests for Type-Safe Command Option Accessors
 */

import { describe, it, expect, vi } from 'vitest';
import { defineTypedOptions, createSchema } from './typedOptions.js';
import type { ChatInputCommandInteraction } from 'discord.js';

describe('typedOptions', () => {
  /**
   * Create a mock interaction with configurable option values
   */
  function createMockInteraction(optionValues: Record<string, unknown>) {
    return {
      options: {
        getString: vi.fn((name: string, required?: boolean) => {
          const value = optionValues[name];
          if (required && value === undefined) {
            throw new Error(`Required option "${name}" not provided`);
          }
          return value ?? null;
        }),
        getInteger: vi.fn((name: string, required?: boolean) => {
          const value = optionValues[name];
          if (required && value === undefined) {
            throw new Error(`Required option "${name}" not provided`);
          }
          return value ?? null;
        }),
        getNumber: vi.fn((name: string, required?: boolean) => {
          const value = optionValues[name];
          if (required && value === undefined) {
            throw new Error(`Required option "${name}" not provided`);
          }
          return value ?? null;
        }),
        getBoolean: vi.fn((name: string, required?: boolean) => {
          const value = optionValues[name];
          if (required && value === undefined) {
            throw new Error(`Required option "${name}" not provided`);
          }
          return value ?? null;
        }),
        getUser: vi.fn((name: string, required?: boolean) => {
          const value = optionValues[name];
          if (required && value === undefined) {
            throw new Error(`Required option "${name}" not provided`);
          }
          return value ?? null;
        }),
        getChannel: vi.fn((name: string, required?: boolean) => {
          const value = optionValues[name];
          if (required && value === undefined) {
            throw new Error(`Required option "${name}" not provided`);
          }
          return value ?? null;
        }),
        getRole: vi.fn((name: string, required?: boolean) => {
          const value = optionValues[name];
          if (required && value === undefined) {
            throw new Error(`Required option "${name}" not provided`);
          }
          return value ?? null;
        }),
        getMentionable: vi.fn((name: string, required?: boolean) => {
          const value = optionValues[name];
          if (required && value === undefined) {
            throw new Error(`Required option "${name}" not provided`);
          }
          return value ?? null;
        }),
        getAttachment: vi.fn((name: string, required?: boolean) => {
          const value = optionValues[name];
          if (required && value === undefined) {
            throw new Error(`Required option "${name}" not provided`);
          }
          return value ?? null;
        }),
      },
    } as unknown as ChatInputCommandInteraction;
  }

  describe('defineTypedOptions', () => {
    it('should create accessor for required string option', () => {
      const getOptions = defineTypedOptions({
        personality: { type: 'string', required: true },
      });

      const interaction = createMockInteraction({ personality: 'lilith' });
      const options = getOptions(interaction);

      const result = options.personality();

      expect(result).toBe('lilith');
      expect(interaction.options.getString).toHaveBeenCalledWith('personality', true);
    });

    it('should create accessor for optional string option', () => {
      const getOptions = defineTypedOptions({
        query: { type: 'string', required: false },
      });

      const interaction = createMockInteraction({});
      const options = getOptions(interaction);

      const result = options.query();

      expect(result).toBeNull();
      expect(interaction.options.getString).toHaveBeenCalledWith('query', false);
    });

    it('should create accessor for integer option', () => {
      const getOptions = defineTypedOptions({
        limit: { type: 'integer', required: true },
      });

      const interaction = createMockInteraction({ limit: 10 });
      const options = getOptions(interaction);

      expect(options.limit()).toBe(10);
      expect(interaction.options.getInteger).toHaveBeenCalledWith('limit', true);
    });

    it('should create accessor for number option', () => {
      const getOptions = defineTypedOptions({
        temperature: { type: 'number', required: false },
      });

      const interaction = createMockInteraction({ temperature: 0.7 });
      const options = getOptions(interaction);

      expect(options.temperature()).toBe(0.7);
      expect(interaction.options.getNumber).toHaveBeenCalledWith('temperature', false);
    });

    it('should create accessor for boolean option', () => {
      const getOptions = defineTypedOptions({
        ephemeral: { type: 'boolean', required: false },
      });

      const interaction = createMockInteraction({ ephemeral: true });
      const options = getOptions(interaction);

      expect(options.ephemeral()).toBe(true);
      expect(interaction.options.getBoolean).toHaveBeenCalledWith('ephemeral', false);
    });

    it('should handle multiple options with different types', () => {
      const getOptions = defineTypedOptions({
        personality: { type: 'string', required: true },
        limit: { type: 'integer', required: false },
        active: { type: 'boolean', required: false },
      });

      const interaction = createMockInteraction({
        personality: 'lilith',
        limit: 5,
        active: true,
      });
      const options = getOptions(interaction);

      expect(options.personality()).toBe('lilith');
      expect(options.limit()).toBe(5);
      expect(options.active()).toBe(true);
    });

    it('should return null for missing optional options', () => {
      const getOptions = defineTypedOptions({
        name: { type: 'string', required: true },
        description: { type: 'string', required: false },
      });

      const interaction = createMockInteraction({ name: 'Test' });
      const options = getOptions(interaction);

      expect(options.name()).toBe('Test');
      expect(options.description()).toBeNull();
    });

    it('should be reusable across multiple interactions', () => {
      const getOptions = defineTypedOptions({
        value: { type: 'string', required: true },
      });

      const interaction1 = createMockInteraction({ value: 'first' });
      const interaction2 = createMockInteraction({ value: 'second' });

      expect(getOptions(interaction1).value()).toBe('first');
      expect(getOptions(interaction2).value()).toBe('second');
    });
  });

  describe('createSchema', () => {
    it('should return the schema unchanged (type helper)', () => {
      const schema = createSchema({
        name: { type: 'string', required: true },
        count: { type: 'integer', required: false },
      } as const);

      expect(schema).toEqual({
        name: { type: 'string', required: true },
        count: { type: 'integer', required: false },
      });
    });
  });

  describe('type safety', () => {
    it('should enforce option names at compile time', () => {
      // This test documents the type safety behavior.
      // If someone tries to access options.nonexistent(), TypeScript will error.

      const getOptions = defineTypedOptions({
        personality: { type: 'string', required: true },
      });

      const interaction = createMockInteraction({ personality: 'test' });
      const options = getOptions(interaction);

      // options.personality() is valid
      expect(typeof options.personality).toBe('function');

      // options.nonexistent would be a TypeScript error:
      // Property 'nonexistent' does not exist on type 'TypedOptionsAccessor<...>'
      // We can't test this at runtime, but the type system catches it.
    });
  });
});
