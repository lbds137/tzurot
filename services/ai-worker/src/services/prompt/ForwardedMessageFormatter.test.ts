import { describe, it, expect } from 'vitest';
import { formatForwardedQuote, type ForwardedMessageContent } from './ForwardedMessageFormatter.js';

describe('ForwardedMessageFormatter', () => {
  describe('formatForwardedQuote', () => {
    it('should format a text-only forwarded message', () => {
      const content: ForwardedMessageContent = {
        textContent: 'Hello from the other channel',
      };

      const result = formatForwardedQuote(content);

      expect(result).toBe(
        '<quote type="forward" author="Unknown">\n' +
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

      expect(result).toContain('<quote type="forward" author="Unknown">');
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

      expect(result).toBe('<quote type="forward" author="Unknown">\n</quote>');
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
