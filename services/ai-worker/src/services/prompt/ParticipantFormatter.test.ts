/**
 * Tests for ParticipantFormatter
 *
 * Tests the pure XML participant formatting with:
 * - ID binding via <participant id="...">
 * - Structured fields (<name>, <pronouns>)
 * - CDATA wrapping for user content
 * - source="user_input" attribution
 * - Optional guild info (roles, color, join date)
 */

import { describe, it, expect } from 'vitest';
import { formatParticipantsContext } from './ParticipantFormatter.js';
import type { ParticipantInfo } from '../ConversationalRAGService.js';

describe('ParticipantFormatter', () => {
  describe('formatParticipantsContext', () => {
    describe('XML wrapper', () => {
      it('should wrap output in <participants> tags when participants exist', () => {
        const participants = new Map<string, ParticipantInfo>([
          ['Alice', { content: 'A software developer', isActive: true, personaId: 'persona-123' }],
        ]);

        const result = formatParticipantsContext(participants, 'Alice');

        expect(result).toContain('<participants>');
        expect(result).toContain('</participants>');
      });

      it('should not add XML wrapper when no participants', () => {
        const result = formatParticipantsContext(new Map());

        expect(result).toBe('');
        expect(result).not.toContain('<participants>');
      });

      it('should have properly closed XML tags', () => {
        const participants = new Map<string, ParticipantInfo>([
          ['Alice', { content: 'Dev', isActive: true, personaId: 'persona-1' }],
          ['Bob', { content: 'Designer', isActive: false, personaId: 'persona-2' }],
        ]);

        const result = formatParticipantsContext(participants, 'Alice');

        // Count opening and closing tags
        const openTags = (result.match(/<participants>/g) || []).length;
        const closeTags = (result.match(/<\/participants>/g) || []).length;
        expect(openTags).toBe(1);
        expect(closeTags).toBe(1);
      });
    });

    it('should return empty string when no participants', () => {
      const result = formatParticipantsContext(new Map());
      expect(result).toBe('');
    });

    it('should format single participant with ID binding', () => {
      const participants = new Map<string, ParticipantInfo>([
        ['Alice', { content: 'A software developer', isActive: true, personaId: 'persona-123' }],
      ]);

      const result = formatParticipantsContext(participants, 'Alice');

      // Check for XML structure with ID binding
      expect(result).toContain('<participant id="persona-123"');
      expect(result).toContain('<name>Alice</name>');
      expect(result).toContain(
        '<about source="user_input"><![CDATA[A software developer]]></about>'
      );
      expect(result).toContain('</participant>');
      // Single participant should NOT have group note
      expect(result).not.toContain('<note>');
    });

    it('should mark active participant', () => {
      const participants = new Map<string, ParticipantInfo>([
        ['Alice', { content: 'Developer', isActive: true, personaId: 'persona-1' }],
      ]);

      const result = formatParticipantsContext(participants, 'Alice');

      expect(result).toContain('active="true"');
    });

    it('should not mark inactive participants as active', () => {
      const participants = new Map<string, ParticipantInfo>([
        ['Alice', { content: 'Developer', isActive: false, personaId: 'persona-1' }],
      ]);

      const result = formatParticipantsContext(participants, 'Alice');

      expect(result).not.toContain('active="true"');
    });

    it('should format multiple participants with group note', () => {
      const participants = new Map<string, ParticipantInfo>([
        ['Alice', { content: 'A software developer', isActive: true, personaId: 'persona-1' }],
        ['Bob', { content: 'A designer', isActive: false, personaId: 'persona-2' }],
      ]);

      const result = formatParticipantsContext(participants, 'Alice');

      // Check both participants
      expect(result).toContain('<participant id="persona-1"');
      expect(result).toContain('<name>Alice</name>');
      expect(result).toContain('<participant id="persona-2"');
      expect(result).toContain('<name>Bob</name>');
      // Group note should be present
      expect(result).toContain('<note>This is a group conversation');
      expect(result).toContain('Alice: message');
    });

    it('should use provided activePersonaName in group note', () => {
      const participants = new Map<string, ParticipantInfo>([
        ['Alice', { content: 'Person 1', isActive: false, personaId: 'persona-1' }],
        ['Bob', { content: 'Person 2', isActive: true, personaId: 'persona-2' }],
      ]);

      const result = formatParticipantsContext(participants, 'Bob');

      expect(result).toContain('Bob: message');
    });

    it('should use fallback name when activePersonaName is undefined', () => {
      const participants = new Map<string, ParticipantInfo>([
        ['Alice', { content: 'Person 1', isActive: true, personaId: 'persona-1' }],
        ['Bob', { content: 'Person 2', isActive: false, personaId: 'persona-2' }],
      ]);

      const result = formatParticipantsContext(participants);

      // Fallback is "Alice" (first example in implementation)
      expect(result).toContain('Alice: message');
    });

    it('should use fallback name when activePersonaName is empty', () => {
      const participants = new Map<string, ParticipantInfo>([
        ['Alice', { content: 'Person 1', isActive: true, personaId: 'persona-1' }],
        ['Bob', { content: 'Person 2', isActive: false, personaId: 'persona-2' }],
      ]);

      const result = formatParticipantsContext(participants, '');

      // Fallback is "Alice" (first example in implementation)
      expect(result).toContain('Alice: message');
    });

    it('should format three participants', () => {
      const participants = new Map<string, ParticipantInfo>([
        ['Alice', { content: 'Developer', isActive: true, personaId: 'persona-1' }],
        ['Bob', { content: 'Designer', isActive: false, personaId: 'persona-2' }],
        ['Charlie', { content: 'Manager', isActive: false, personaId: 'persona-3' }],
      ]);

      const result = formatParticipantsContext(participants, 'Alice');

      expect(result).toContain('<name>Alice</name>');
      expect(result).toContain('<![CDATA[Developer]]>');
      expect(result).toContain('<name>Bob</name>');
      expect(result).toContain('<![CDATA[Designer]]>');
      expect(result).toContain('<name>Charlie</name>');
      expect(result).toContain('<![CDATA[Manager]]>');
      expect(result).toContain('<note>This is a group conversation');
    });

    it('should preserve participant order from Map', () => {
      const participants = new Map<string, ParticipantInfo>([
        ['First', { content: 'Content 1', isActive: true, personaId: 'persona-1' }],
        ['Second', { content: 'Content 2', isActive: false, personaId: 'persona-2' }],
        ['Third', { content: 'Content 3', isActive: false, personaId: 'persona-3' }],
      ]);

      const result = formatParticipantsContext(participants);

      const firstIndex = result.indexOf('<name>First</name>');
      const secondIndex = result.indexOf('<name>Second</name>');
      const thirdIndex = result.indexOf('<name>Third</name>');

      expect(firstIndex).toBeLessThan(secondIndex);
      expect(secondIndex).toBeLessThan(thirdIndex);
    });

    it('should include instruction element', () => {
      const participants = new Map<string, ParticipantInfo>([
        ['Alice', { content: 'Developer', isActive: true, personaId: 'persona-1' }],
      ]);

      const result = formatParticipantsContext(participants, 'Alice');

      expect(result).toContain('<instruction>');
      expect(result).toContain('from_id');
      expect(result).toContain('</instruction>');
    });

    it('should escape XML special characters in persona names', () => {
      const participants = new Map<string, ParticipantInfo>([
        ['Alice <Admin>', { content: 'Content', isActive: true, personaId: 'persona-1' }],
      ]);

      const result = formatParticipantsContext(participants, 'Alice <Admin>');

      // Name should be escaped
      expect(result).toContain('<name>Alice &lt;Admin&gt;</name>');
    });

    it('should escape XML special characters in persona ID', () => {
      const participants = new Map<string, ParticipantInfo>([
        ['Alice', { content: 'Content', isActive: true, personaId: 'persona-123&456' }],
      ]);

      const result = formatParticipantsContext(participants, 'Alice');

      // ID should be escaped in attribute
      expect(result).toContain('id="persona-123&amp;456"');
    });

    describe('pronouns and preferredName', () => {
      it('should include pronouns element when pronouns are provided', () => {
        const participants = new Map<string, ParticipantInfo>([
          [
            'Lila',
            {
              content: 'A software developer',
              isActive: true,
              personaId: 'persona-1',
              pronouns: 'she/her, they/them',
            },
          ],
        ]);

        const result = formatParticipantsContext(participants, 'Lila');

        expect(result).toContain('<pronouns>she/her, they/them</pronouns>');
      });

      it('should not include pronouns element when pronouns are undefined', () => {
        const participants = new Map<string, ParticipantInfo>([
          [
            'Alice',
            {
              content: 'A developer',
              isActive: true,
              personaId: 'persona-1',
              // pronouns not set
            },
          ],
        ]);

        const result = formatParticipantsContext(participants, 'Alice');

        expect(result).not.toContain('<pronouns>');
      });

      it('should not include pronouns element when pronouns are empty string', () => {
        const participants = new Map<string, ParticipantInfo>([
          [
            'Alice',
            {
              content: 'A developer',
              isActive: true,
              personaId: 'persona-1',
              pronouns: '',
            },
          ],
        ]);

        const result = formatParticipantsContext(participants, 'Alice');

        expect(result).not.toContain('<pronouns>');
      });

      it('should use preferredName for display name when provided', () => {
        const participants = new Map<string, ParticipantInfo>([
          [
            'lila', // Map key (persona name from DB)
            {
              preferredName: 'Lila ☠',
              content: 'A developer',
              isActive: true,
              personaId: 'persona-1',
            },
          ],
        ]);

        const result = formatParticipantsContext(participants, 'Lila ☠');

        // Should use preferredName, not the map key
        expect(result).toContain('<name>Lila ☠</name>');
        expect(result).not.toContain('<name>lila</name>');
      });

      it('should fall back to map key when preferredName is undefined', () => {
        const participants = new Map<string, ParticipantInfo>([
          [
            'Alice',
            {
              content: 'A developer',
              isActive: true,
              personaId: 'persona-1',
              // preferredName not set
            },
          ],
        ]);

        const result = formatParticipantsContext(participants, 'Alice');

        expect(result).toContain('<name>Alice</name>');
      });

      it('should escape special characters in pronouns', () => {
        const participants = new Map<string, ParticipantInfo>([
          [
            'Alice',
            {
              content: 'A developer',
              isActive: true,
              personaId: 'persona-1',
              pronouns: 'she/her & they/them',
            },
          ],
        ]);

        const result = formatParticipantsContext(participants, 'Alice');

        expect(result).toContain('<pronouns>she/her &amp; they/them</pronouns>');
      });

      it('should order elements correctly: name, pronouns, guild_info, about', () => {
        const participants = new Map<string, ParticipantInfo>([
          [
            'Lila',
            {
              preferredName: 'Lila',
              pronouns: 'she/her',
              content: 'A developer',
              isActive: true,
              personaId: 'persona-1',
              guildInfo: {
                roles: ['Admin'],
              },
            },
          ],
        ]);

        const result = formatParticipantsContext(participants, 'Lila');

        const nameIndex = result.indexOf('<name>Lila</name>');
        const pronounsIndex = result.indexOf('<pronouns>she/her</pronouns>');
        const guildInfoIndex = result.indexOf('<guild_info');
        const aboutIndex = result.indexOf('<about');

        expect(nameIndex).toBeLessThan(pronounsIndex);
        expect(pronounsIndex).toBeLessThan(guildInfoIndex);
        expect(guildInfoIndex).toBeLessThan(aboutIndex);
      });
    });

    describe('guild info', () => {
      it('should include guild_info element when guildInfo is provided', () => {
        const participants = new Map<string, ParticipantInfo>([
          [
            'Alice',
            {
              content: 'Developer',
              isActive: true,
              personaId: 'persona-1',
              guildInfo: {
                roles: ['Admin', 'Developer'],
                displayColor: '#FF00FF',
                joinedAt: '2023-05-15T10:30:00Z',
              },
            },
          ],
        ]);

        const result = formatParticipantsContext(participants, 'Alice');

        expect(result).toContain('<guild_info');
        expect(result).toContain('<roles>');
        expect(result).toContain('<role>Admin</role>');
        expect(result).toContain('<role>Developer</role>');
        expect(result).toContain('</roles>');
        expect(result).toContain('color="#FF00FF"');
        expect(result).toContain('joined="2023-05-15"');
        expect(result).toContain('</guild_info>');
      });

      it('should format join date as date only (no time)', () => {
        const participants = new Map<string, ParticipantInfo>([
          [
            'Alice',
            {
              content: 'Developer',
              isActive: true,
              personaId: 'persona-1',
              guildInfo: {
                roles: [],
                joinedAt: '2023-05-15T10:30:00.000Z',
              },
            },
          ],
        ]);

        const result = formatParticipantsContext(participants, 'Alice');

        // Should only include date part
        expect(result).toContain('joined="2023-05-15"');
        expect(result).not.toContain('T10:30');
      });

      it('should omit guild_info when no guild info properties are set', () => {
        const participants = new Map<string, ParticipantInfo>([
          [
            'Alice',
            {
              content: 'Developer',
              isActive: true,
              personaId: 'persona-1',
              guildInfo: {
                roles: [],
              },
            },
          ],
        ]);

        const result = formatParticipantsContext(participants, 'Alice');

        // No guild_info since roles is empty and no other properties
        expect(result).not.toContain('<guild_info');
      });

      it('should include guild_info with only roles', () => {
        const participants = new Map<string, ParticipantInfo>([
          [
            'Alice',
            {
              content: 'Developer',
              isActive: true,
              personaId: 'persona-1',
              guildInfo: {
                roles: ['Member', 'Tester'],
              },
            },
          ],
        ]);

        const result = formatParticipantsContext(participants, 'Alice');

        expect(result).toContain('<guild_info>');
        expect(result).toContain('<roles>');
        expect(result).toContain('<role>Member</role>');
        expect(result).toContain('<role>Tester</role>');
        expect(result).toContain('</roles>');
        expect(result).toContain('</guild_info>');
      });

      it('should include guild_info with only color', () => {
        const participants = new Map<string, ParticipantInfo>([
          [
            'Alice',
            {
              content: 'Developer',
              isActive: true,
              personaId: 'persona-1',
              guildInfo: {
                roles: [],
                displayColor: '#00FF00',
              },
            },
          ],
        ]);

        const result = formatParticipantsContext(participants, 'Alice');

        expect(result).toContain('<guild_info color="#00FF00"/>');
      });

      it('should not include guild_info when guildInfo is undefined', () => {
        const participants = new Map<string, ParticipantInfo>([
          [
            'Alice',
            {
              content: 'Developer',
              isActive: true,
              personaId: 'persona-1',
              // No guildInfo
            },
          ],
        ]);

        const result = formatParticipantsContext(participants, 'Alice');

        expect(result).not.toContain('<guild_info');
      });

      it('should escape special characters in role names', () => {
        const participants = new Map<string, ParticipantInfo>([
          [
            'Alice',
            {
              content: 'Developer',
              isActive: true,
              personaId: 'persona-1',
              guildInfo: {
                roles: ['Admin & Manager', 'Dev "Expert"'],
              },
            },
          ],
        ]);

        const result = formatParticipantsContext(participants, 'Alice');

        // Roles should be escaped within <role> elements
        expect(result).toContain('<role>Admin &amp; Manager</role>');
        expect(result).toContain('<role>Dev &quot;Expert&quot;</role>');
      });
    });

    describe('CDATA wrapping', () => {
      it('should wrap persona content in CDATA', () => {
        const participants = new Map<string, ParticipantInfo>([
          ['Alice', { content: 'I am a developer', isActive: true, personaId: 'persona-1' }],
        ]);

        const result = formatParticipantsContext(participants, 'Alice');

        expect(result).toContain('<![CDATA[I am a developer]]>');
      });

      it('should include source="user_input" attribute', () => {
        const participants = new Map<string, ParticipantInfo>([
          ['Alice', { content: 'Content', isActive: true, personaId: 'persona-1' }],
        ]);

        const result = formatParticipantsContext(participants, 'Alice');

        expect(result).toContain('source="user_input"');
      });

      it('should handle content with XML-like characters without escaping', () => {
        const participants = new Map<string, ParticipantInfo>([
          [
            'Alice',
            {
              content: 'I like <tags> and "quotes" & special chars',
              isActive: true,
              personaId: 'persona-1',
            },
          ],
        ]);

        const result = formatParticipantsContext(participants, 'Alice');

        // CDATA preserves content as-is
        expect(result).toContain('<![CDATA[I like <tags> and "quotes" & special chars]]>');
      });
    });
  });
});
