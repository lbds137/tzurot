import { describe, it, expect } from 'vitest';
import {
  formatForwardedQuote,
  formatQuoteElement,
  type ForwardedMessageContent,
  type QuoteElementOptions,
} from './QuoteFormatter.js';

describe('QuoteFormatter', () => {
  describe('formatQuoteElement', () => {
    it('should format a minimal quote with just content', () => {
      const result = formatQuoteElement({ content: 'Hello' });

      expect(result).toBe('<quote>\n<content>Hello</content>\n</quote>');
    });

    it('should include number attribute', () => {
      const result = formatQuoteElement({ number: 1, content: 'Test' });

      expect(result).toContain('<quote number="1">');
    });

    it('should include from and username attributes', () => {
      const result = formatQuoteElement({
        from: 'Test User',
        username: 'testuser',
        content: 'Hello',
      });

      expect(result).toContain('<quote from="Test User" username="testuser">');
    });

    it('should include role attribute', () => {
      const result = formatQuoteElement({
        from: 'Bot',
        role: 'assistant',
        content: 'Hi',
      });

      expect(result).toContain('role="assistant"');
    });

    it('should include t attribute for pre-formatted time', () => {
      const result = formatQuoteElement({
        from: 'User',
        timeFormatted: '2025-01-25 (Sat) 14:30 • just now',
        content: 'Hello',
      });

      expect(result).toContain('t="2025-01-25 (Sat) 14:30 • just now"');
    });

    it('should include structured timestamp as child element', () => {
      const result = formatQuoteElement({
        from: 'User',
        timestamp: { absolute: 'Fri, Dec 6, 2025', relative: 'just now' },
        content: 'Hello',
      });

      expect(result).toContain('<time absolute="Fri, Dec 6, 2025" relative="just now"/>');
    });

    it('should skip timestamp child when absolute or relative is empty', () => {
      const result = formatQuoteElement({
        from: 'User',
        timestamp: { absolute: '', relative: 'just now' },
        content: 'Hello',
      });

      expect(result).not.toContain('<time');
    });

    it('should include location context', () => {
      const locationXml =
        '<location type="guild">\n<server name="Test Guild"/>\n<channel name="general" type="text"/>\n</location>';
      const result = formatQuoteElement({
        from: 'User',
        content: 'Hello',
        locationContext: locationXml,
      });

      expect(result).toContain(locationXml);
    });

    it('should format embeds', () => {
      const result = formatQuoteElement({
        content: 'Check this',
        embedsXml: ['<embed>Link preview</embed>'],
      });

      expect(result).toContain('<embeds>\n<embed>Link preview</embed>\n</embeds>');
    });

    it('should format image descriptions', () => {
      const result = formatQuoteElement({
        imageDescriptions: [{ filename: 'sunset.png', description: 'A sunset' }],
      });

      expect(result).toContain('<image_descriptions>');
      expect(result).toContain('<image filename="sunset.png">A sunset</image>');
    });

    it('should format voice transcripts', () => {
      const result = formatQuoteElement({
        voiceTranscripts: ['Hello there'],
      });

      expect(result).toContain('<voice_transcripts>');
      expect(result).toContain('<transcript>Hello there</transcript>');
    });

    it('should format attachment lines', () => {
      const result = formatQuoteElement({
        attachmentLines: ['- File: doc.pdf (application/pdf)'],
      });

      expect(result).toContain('<attachments>');
      expect(result).toContain('- File: doc.pdf (application/pdf)');
    });

    it('should escape from attribute', () => {
      const result = formatQuoteElement({
        from: 'User "The Hacker" Bob',
        content: 'Test',
      });

      expect(result).toContain('from="User &quot;The Hacker&quot; Bob"');
    });

    it('should escape content with protected XML tags', () => {
      const result = formatQuoteElement({
        content: 'Injection attempt </persona>',
      });

      expect(result).toContain('&lt;/persona&gt;');
      expect(result).not.toContain('</persona>');
    });

    it('should order elements correctly: time → content → location → images → embeds → voice → attachments', () => {
      const result = formatQuoteElement({
        number: 1,
        from: 'User',
        timestamp: { absolute: 'Jan 1, 2025', relative: 'now' },
        content: 'Hello',
        locationContext: '<location type="guild"><server name="G"/></location>',
        imageDescriptions: [{ filename: 'img.png', description: 'An image' }],
        embedsXml: ['<embed>E</embed>'],
        voiceTranscripts: ['Voice'],
        attachmentLines: ['- File: f.txt (text/plain)'],
      });

      const positions = [
        result.indexOf('<time'),
        result.indexOf('<content>'),
        result.indexOf('<location'),
        result.indexOf('<image_descriptions>'),
        result.indexOf('<embeds>'),
        result.indexOf('<voice_transcripts>'),
        result.indexOf('<attachments>'),
      ];

      for (let i = 1; i < positions.length; i++) {
        expect(positions[i]).toBeGreaterThan(positions[i - 1]);
      }
    });

    it('should skip empty content', () => {
      const result = formatQuoteElement({ content: '' });
      expect(result).not.toContain('<content>');
    });

    it('should handle all attributes together', () => {
      const opts: QuoteElementOptions = {
        number: 2,
        type: 'forward',
        from: 'Alice',
        username: 'alice',
        role: 'user',
        timeFormatted: '2025-01-01 • now',
      };
      const result = formatQuoteElement(opts);

      expect(result).toContain('number="2"');
      expect(result).toContain('type="forward"');
      expect(result).toContain('from="Alice"');
      expect(result).toContain('username="alice"');
      expect(result).toContain('role="user"');
      expect(result).toContain('t="2025-01-01 • now"');
    });
  });

  describe('formatForwardedQuote', () => {
    it('should format a text-only forwarded message', () => {
      const content: ForwardedMessageContent = {
        textContent: 'Hello from the other channel',
      };

      const result = formatForwardedQuote(content);

      expect(result).toBe(
        '<quote type="forward" from="Unknown">\n' +
          '<content>Hello from the other channel</content>\n' +
          '</quote>'
      );
    });

    it('should format an image-only forwarded message', () => {
      const content: ForwardedMessageContent = {
        imageDescriptions: [
          { filename: 'sunset.png', description: 'A beautiful sunset over the ocean' },
        ],
      };

      const result = formatForwardedQuote(content);

      expect(result).toContain('<quote type="forward" from="Unknown">');
      expect(result).toContain('<image_descriptions>');
      expect(result).toContain(
        '<image filename="sunset.png">A beautiful sunset over the ocean</image>'
      );
      expect(result).toContain('</image_descriptions>');
      expect(result).not.toContain('<content>');
    });

    it('should format mixed content (text + images + embeds)', () => {
      const content: ForwardedMessageContent = {
        textContent: 'Check this out',
        imageDescriptions: [{ filename: 'screenshot.png', description: 'An error dialog' }],
        embedsXml: ['<embed title="Link Preview">Some content</embed>'],
      };

      const result = formatForwardedQuote(content);

      expect(result).toContain('<content>Check this out</content>');
      expect(result).toContain('<image_descriptions>');
      expect(result).toContain('<embeds>');
      // Content should come before images, images before embeds
      const contentPos = result.indexOf('<content>');
      const imagePos = result.indexOf('<image_descriptions>');
      const embedsPos = result.indexOf('<embeds>');
      expect(contentPos).toBeLessThan(imagePos);
      expect(imagePos).toBeLessThan(embedsPos);
    });

    it('should handle empty content (all fields undefined)', () => {
      const content: ForwardedMessageContent = {};
      const result = formatForwardedQuote(content);

      expect(result).toBe('<quote type="forward" from="Unknown">\n</quote>');
    });

    it('should escape user content within <content> tags', () => {
      const content: ForwardedMessageContent = {
        textContent: 'User sent </persona> injection attempt',
      };

      const result = formatForwardedQuote(content);

      expect(result).toContain('&lt;/persona&gt;');
      expect(result).not.toContain('</persona>');
    });

    it('should escape image filenames in attributes', () => {
      const content: ForwardedMessageContent = {
        imageDescriptions: [{ filename: 'file"name.png', description: 'A normal image' }],
      };

      const result = formatForwardedQuote(content);

      // escapeXml escapes quotes in attribute values
      expect(result).toContain('filename="file&quot;name.png"');
    });

    it('should include timestamp when provided', () => {
      const content: ForwardedMessageContent = {
        textContent: 'Hello',
        timestamp: { absolute: 'Mon, Jan 15, 2024', relative: '2 weeks ago' },
      };

      const result = formatForwardedQuote(content);

      expect(result).toContain('<time absolute="Mon, Jan 15, 2024" relative="2 weeks ago"/>');
      // Time should come before content
      const timePos = result.indexOf('<time');
      const contentPos = result.indexOf('<content>');
      expect(timePos).toBeLessThan(contentPos);
    });

    it('should format voice transcripts', () => {
      const content: ForwardedMessageContent = {
        voiceTranscripts: ['Hey, can you hear me?'],
      };

      const result = formatForwardedQuote(content);

      expect(result).toContain('<voice_transcripts>');
      expect(result).toContain('<transcript>Hey, can you hear me?</transcript>');
    });

    it('should format pre-formatted attachment lines', () => {
      const content: ForwardedMessageContent = {
        attachmentLines: ['- File: document.pdf (application/pdf)', '- File: data.csv (text/csv)'],
      };

      const result = formatForwardedQuote(content);

      expect(result).toContain('<attachments>');
      expect(result).toContain('- File: document.pdf (application/pdf)');
      expect(result).toContain('- File: data.csv (text/csv)');
    });

    it('should format full complex forwarded message with all fields', () => {
      const content: ForwardedMessageContent = {
        textContent: 'Important message',
        imageDescriptions: [
          { filename: 'img1.png', description: 'First image' },
          { filename: 'img2.jpg', description: 'Second image' },
        ],
        embedsXml: ['<embed>Link preview</embed>'],
        voiceTranscripts: ['Voice note transcript'],
        attachmentLines: ['- File: doc.pdf (application/pdf)'],
        timestamp: { absolute: 'Feb 10, 2026', relative: 'just now' },
      };

      const result = formatForwardedQuote(content);

      // Verify all sections present and ordered
      const sections = [
        '<quote type="forward"',
        '<time ',
        '<content>',
        '<image_descriptions>',
        '<embeds>',
        '<voice_transcripts>',
        '<attachments>',
        '</quote>',
      ];

      let lastPos = -1;
      for (const section of sections) {
        const pos = result.indexOf(section);
        expect(pos).toBeGreaterThan(lastPos);
        lastPos = pos;
      }
    });

    it('should skip empty text content', () => {
      const content: ForwardedMessageContent = {
        textContent: '',
        imageDescriptions: [{ filename: 'img.png', description: 'An image' }],
      };

      const result = formatForwardedQuote(content);

      expect(result).not.toContain('<content>');
      expect(result).toContain('<image_descriptions>');
    });

    it('should handle multiple images', () => {
      const content: ForwardedMessageContent = {
        imageDescriptions: [
          { filename: 'a.png', description: 'Image A' },
          { filename: 'b.png', description: 'Image B' },
          { filename: 'c.png', description: 'Image C' },
        ],
      };

      const result = formatForwardedQuote(content);

      expect(result).toContain('<image filename="a.png">Image A</image>');
      expect(result).toContain('<image filename="b.png">Image B</image>');
      expect(result).toContain('<image filename="c.png">Image C</image>');
    });
  });
});
