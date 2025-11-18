/**
 * Tests for ParticipantFormatter
 */

import { describe, it, expect } from 'vitest';
import { formatParticipantsContext } from './ParticipantFormatter.js';

describe('ParticipantFormatter', () => {
  describe('formatParticipantsContext', () => {
    it('should return empty string when no participants', () => {
      const result = formatParticipantsContext(new Map());
      expect(result).toBe('');
    });

    it('should format single participant without group note', () => {
      const participants = new Map([
        ['Alice', { content: 'A software developer', isActive: true }],
      ]);

      const result = formatParticipantsContext(participants, 'Alice');

      expect(result).toContain('## Conversation Participants');
      expect(result).toContain('person is involved');
      expect(result).toContain('### Alice');
      expect(result).toContain('A software developer');
      expect(result).not.toContain('Note: This is a group conversation');
    });

    it('should format multiple participants with group note', () => {
      const participants = new Map([
        ['Alice', { content: 'A software developer', isActive: true }],
        ['Bob', { content: 'A designer', isActive: false }],
      ]);

      const result = formatParticipantsContext(participants, 'Alice');

      expect(result).toContain('## Conversation Participants');
      expect(result).toContain('people are involved');
      expect(result).toContain('### Alice');
      expect(result).toContain('A software developer');
      expect(result).toContain('### Bob');
      expect(result).toContain('A designer');
      expect(result).toContain('Note: This is a group conversation');
      expect(result).toContain('Alice: message');
    });

    it('should use provided activePersonaName in group note', () => {
      const participants = new Map([
        ['Alice', { content: 'Person 1', isActive: true }],
        ['Bob', { content: 'Person 2', isActive: false }],
      ]);

      const result = formatParticipantsContext(participants, 'Bob');

      expect(result).toContain('Bob: message');
    });

    it('should use fallback name when activePersonaName is undefined', () => {
      const participants = new Map([
        ['Alice', { content: 'Person 1', isActive: true }],
        ['Bob', { content: 'Person 2', isActive: false }],
      ]);

      const result = formatParticipantsContext(participants);

      expect(result).toContain('Alice: message');
    });

    it('should use fallback name when activePersonaName is empty', () => {
      const participants = new Map([
        ['Alice', { content: 'Person 1', isActive: true }],
        ['Bob', { content: 'Person 2', isActive: false }],
      ]);

      const result = formatParticipantsContext(participants, '');

      expect(result).toContain('Alice: message');
    });

    it('should format three participants', () => {
      const participants = new Map([
        ['Alice', { content: 'Developer', isActive: true }],
        ['Bob', { content: 'Designer', isActive: false }],
        ['Charlie', { content: 'Manager', isActive: false }],
      ]);

      const result = formatParticipantsContext(participants, 'Alice');

      expect(result).toContain('### Alice');
      expect(result).toContain('Developer');
      expect(result).toContain('### Bob');
      expect(result).toContain('Designer');
      expect(result).toContain('### Charlie');
      expect(result).toContain('Manager');
      expect(result).toContain('people are involved');
      expect(result).toContain('Note: This is a group conversation');
    });

    it('should preserve participant order from Map', () => {
      const participants = new Map([
        ['First', { content: 'Content 1', isActive: true }],
        ['Second', { content: 'Content 2', isActive: false }],
        ['Third', { content: 'Content 3', isActive: false }],
      ]);

      const result = formatParticipantsContext(participants);

      const firstIndex = result.indexOf('### First');
      const secondIndex = result.indexOf('### Second');
      const thirdIndex = result.indexOf('### Third');

      expect(firstIndex).toBeLessThan(secondIndex);
      expect(secondIndex).toBeLessThan(thirdIndex);
    });
  });
});
