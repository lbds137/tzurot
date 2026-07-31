import { describe, it, expect } from 'vitest';
import {
  formatDedupedQuote,
  formatForwardedQuote,
  formatQuoteElement,
  renderAttachment,
  type ForwardedMessageContent,
  type QuoteElementOptions,
  type RenderableAttachment,
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

    it('should include from_id attribute', () => {
      const result = formatQuoteElement({
        from: 'Lila',
        fromId: 'persona-uuid-123',
        content: 'Hello',
      });

      expect(result).toContain('from="Lila"');
      expect(result).toContain('from_id="persona-uuid-123"');
    });

    it('should order from_id between from and username', () => {
      const result = formatQuoteElement({
        from: 'Lila',
        fromId: 'p-uuid',
        username: 'lila123',
        content: 'Test',
      });

      const fromPos = result.indexOf('from="Lila"');
      const fromIdPos = result.indexOf('from_id="p-uuid"');
      const usernamePos = result.indexOf('username="lila123"');
      expect(fromIdPos).toBeGreaterThan(fromPos);
      expect(usernamePos).toBeGreaterThan(fromIdPos);
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

    it('renders every modality under one <attachments> wrapper', () => {
      const result = formatQuoteElement({
        attachments: [
          { kind: 'image', filename: 'sunset.png', description: 'A sunset' },
          { kind: 'voice', filename: 'clip.ogg', durationSeconds: 12, description: 'Hello there' },
          { kind: 'file', filename: 'doc.pdf', contentType: 'application/pdf' },
        ],
      });

      expect(result).toContain('<attachments>');
      expect(result).toContain('<image filename="sunset.png">A sunset</image>');
      expect(result).toContain('<voice filename="clip.ogg" duration="12s">Hello there</voice>');
      expect(result).toContain('<file filename="doc.pdf" type="application/pdf"/>');
      // The old vocabulary is gone, not merely unused — a stray emission of it
      // would put the same object back into two competing tag namespaces.
      expect(result).not.toContain('<image_descriptions>');
      expect(result).not.toContain('<voice_transcripts>');
    });

    it('states WHY an attachment carries no enrichment instead of omitting it', () => {
      const result = formatQuoteElement({
        attachments: [
          { kind: 'image', filename: 'unlucky.png', status: 'undescribed' },
          { kind: 'voice', filename: 'muffled.ogg', status: 'untranscribed' },
        ],
      });

      // Self-closing with a reason. A bare element would leave the model unable
      // to tell "vision failed" from "nothing worth describing" and it invents one.
      expect(result).toContain('<image filename="unlucky.png" status="undescribed"/>');
      expect(result).toContain('<voice filename="muffled.ogg" status="untranscribed"/>');
    });

    it('omits the filename attribute entirely when there is no real name', () => {
      const result = formatQuoteElement({
        attachments: [{ kind: 'image', description: 'a nameless picture' }],
      });

      // Never a synthesized placeholder: two producers inventing different ones
      // ('image' vs 'attachment') is what made the old filename correspondence
      // render the same picture twice.
      expect(result).toContain('<image>a nameless picture</image>');
      expect(result).not.toContain('filename=');
    });

    it('escapes a closing tag hidden in a description or transcript', () => {
      const result = formatQuoteElement({
        attachments: [
          { kind: 'image', filename: 'x.png', description: 'sneaky </image></attachments>' },
          { kind: 'voice', filename: 'y.ogg', description: 'sneaky </voice>' },
        ],
      });

      // `image` and `voice` are in PROTECTED_TAGS, so escapeXmlContent neutralizes
      // their closing forms — a crafted description cannot break out of the quote.
      expect(result).toContain('&lt;/image&gt;&lt;/attachments&gt;');
      expect(result).toContain('&lt;/voice&gt;');
      expect(result).not.toContain('sneaky </image>');
      expect(result).not.toContain('sneaky </voice>');
    });

    it('escapes a crafted filename so it cannot close the wrapper', () => {
      const result = formatQuoteElement({
        attachments: [{ kind: 'file', filename: '"/><script>x</script>' }],
      });

      expect(result).not.toContain('<script>');
      expect(result).toContain('&quot;');
    });

    it('makes the per-modality invariants unwriteable (compile-time)', () => {
      // These assertions run at TYPECHECK time (`pnpm typecheck:spec`), not at
      // runtime — each @ts-expect-error fails the build if the union ever stops
      // rejecting that shape. The doc comment used to be the only thing holding
      // these; a reviewer correctly pointed out a comment is not an invariant.
      // Each literal is on ONE line so the suppression sits directly above the
      // property TypeScript rejects — an excess-property error is reported at
      // the property, not at the declaration.
      const rejected: RenderableAttachment[] = [
        // A file never carries enrichment — the renderer would silently drop it.
        // @ts-expect-error description is not a field on RenderableFile
        { kind: 'file', filename: 'a.zip', description: 'ignored' },
        // Duration belongs to voice alone.
        // @ts-expect-error durationSeconds is not a field on RenderableImage
        { kind: 'image', filename: 'a.png', durationSeconds: 12 },
        // A status must name its OWN modality's failure.
        // @ts-expect-error 'untranscribed' is not assignable to an image's status
        { kind: 'image', filename: 'a.png', status: 'untranscribed' },
        // @ts-expect-error 'undescribed' is not assignable to a voice's status
        { kind: 'voice', filename: 'a.ogg', status: 'undescribed' },
        // Enrichment is either present or explained, never both — "here is the
        // transcript, and also we failed to transcribe it" is a contradiction.
        // @ts-expect-error description and status are mutually exclusive
        { kind: 'voice', filename: 'a.ogg', description: 'hi', status: 'untranscribed' },
        // @ts-expect-error description and status are mutually exclusive
        { kind: 'image', filename: 'a.png', description: 'a cat', status: 'undescribed' },
      ];

      expect(rejected).toHaveLength(6);
      // The renderer's own contract, asserted for real: a file renders
      // attribute-only, with no place for enrichment to land.
      expect(renderAttachment({ kind: 'file', filename: 'a.zip' })).toBe(
        '<file filename="a.zip"/>'
      );
    });

    it('renders legacy marker strings alongside structured attachments', () => {
      const result = formatQuoteElement({
        attachments: [{ kind: 'image', filename: 'new.png', description: 'structured' }],
        legacyAttachmentLines: ['[image/png: persisted.png]'],
      });

      // One wrapper holds both — the legacy slot exists only because those rows
      // are already in the database as pre-rendered strings.
      expect(result).toContain('<attachments>');
      expect(result).toContain('<image filename="new.png">structured</image>');
      expect(result).toContain('[image/png: persisted.png]');
      expect(result.match(/<attachments>/g)).toHaveLength(1);
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
        content: 'Injection attempt </character>',
      });

      expect(result).toContain('&lt;/character&gt;');
      expect(result).not.toContain('</character>');
    });

    it('should order elements correctly: time → content → location → embeds → attachments', () => {
      const result = formatQuoteElement({
        number: 1,
        from: 'User',
        timestamp: { absolute: 'Jan 1, 2025', relative: 'now' },
        content: 'Hello',
        locationContext: '<location type="guild"><server name="G"/></location>',
        embedsXml: ['<embed>E</embed>'],
        attachments: [
          { kind: 'image', filename: 'img.png', description: 'An image' },
          { kind: 'voice', filename: 'v.ogg', description: 'Voice' },
          { kind: 'file', filename: 'f.txt', contentType: 'text/plain' },
        ],
      });

      const positions = [
        result.indexOf('<time'),
        result.indexOf('<content>'),
        result.indexOf('<location'),
        result.indexOf('<embeds>'),
        result.indexOf('<attachments>'),
      ];

      for (let i = 1; i < positions.length; i++) {
        expect(positions[i]).toBeGreaterThan(positions[i - 1]);
      }

      // Within <attachments>, source order is preserved across modalities — the
      // list is one sequence, not three grouped sections.
      expect(result.indexOf('<image ')).toBeLessThan(result.indexOf('<voice '));
      expect(result.indexOf('<voice ')).toBeLessThan(result.indexOf('<file '));
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
        attachments: [
          {
            kind: 'image',
            filename: 'sunset.png',
            description: 'A beautiful sunset over the ocean',
          },
        ],
      };

      const result = formatForwardedQuote(content);

      expect(result).toContain('<quote type="forward" from="Unknown">');
      expect(result).toContain('<attachments>');
      expect(result).toContain(
        '<image filename="sunset.png">A beautiful sunset over the ocean</image>'
      );
      expect(result).toContain('</attachments>');
      expect(result).not.toContain('<content>');
    });

    it('should format mixed content (text + images + embeds)', () => {
      const content: ForwardedMessageContent = {
        textContent: 'Check this out',
        attachments: [
          { kind: 'image', filename: 'screenshot.png', description: 'An error dialog' },
        ],
        embedsXml: ['<embed title="Link Preview">Some content</embed>'],
      };

      const result = formatForwardedQuote(content);

      expect(result).toContain('<content>Check this out</content>');
      expect(result).toContain('<attachments>');
      expect(result).toContain('<embeds>');
      // Content → embeds → attachments
      const contentPos = result.indexOf('<content>');
      const embedsPos = result.indexOf('<embeds>');
      const attachmentsPos = result.indexOf('<attachments>');
      expect(contentPos).toBeLessThan(embedsPos);
      expect(embedsPos).toBeLessThan(attachmentsPos);
    });

    it('should handle empty content (all fields undefined)', () => {
      const content: ForwardedMessageContent = {};
      const result = formatForwardedQuote(content);

      expect(result).toBe('<quote type="forward" from="Unknown">\n</quote>');
    });

    it('should escape user content within <content> tags', () => {
      const content: ForwardedMessageContent = {
        textContent: 'User sent </character> injection attempt',
      };

      const result = formatForwardedQuote(content);

      expect(result).toContain('&lt;/character&gt;');
      expect(result).not.toContain('</character>');
    });

    it('should escape image filenames in attributes', () => {
      const content: ForwardedMessageContent = {
        attachments: [{ kind: 'image', filename: 'file"name.png', description: 'A normal image' }],
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
        attachments: [{ kind: 'voice', description: 'Hey, can you hear me?' }],
      };

      const result = formatForwardedQuote(content);

      expect(result).toContain('<attachments>');
      expect(result).toContain('<voice>Hey, can you hear me?</voice>');
    });

    it('should format persisted legacy marker lines', () => {
      const content: ForwardedMessageContent = {
        legacyAttachmentLines: ['[image/png: photo.png]', '[text/csv: data.csv]'],
      };

      const result = formatForwardedQuote(content);

      expect(result).toContain('<attachments>');
      expect(result).toContain('[image/png: photo.png]');
      expect(result).toContain('[text/csv: data.csv]');
    });

    it('should format full complex forwarded message with all fields', () => {
      const content: ForwardedMessageContent = {
        textContent: 'Important message',
        attachments: [
          { kind: 'image', filename: 'img1.png', description: 'First image' },
          { kind: 'image', filename: 'img2.jpg', description: 'Second image' },
          { kind: 'voice', description: 'Voice note transcript' },
          { kind: 'file', filename: 'doc.pdf', contentType: 'application/pdf' },
        ],
        embedsXml: ['<embed>Link preview</embed>'],
        timestamp: { absolute: 'Feb 10, 2026', relative: 'just now' },
      };

      const result = formatForwardedQuote(content);

      // Verify all sections present and ordered
      const sections = [
        '<quote type="forward"',
        '<time ',
        '<content>',
        '<embeds>',
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
        attachments: [{ kind: 'image', filename: 'img.png', description: 'An image' }],
      };

      const result = formatForwardedQuote(content);

      expect(result).not.toContain('<content>');
      expect(result).toContain('<attachments>');
    });

    it('should handle multiple images', () => {
      const content: ForwardedMessageContent = {
        attachments: [
          { kind: 'image', filename: 'a.png', description: 'Image A' },
          { kind: 'image', filename: 'b.png', description: 'Image B' },
          { kind: 'image', filename: 'c.png', description: 'Image C' },
        ],
      };

      const result = formatForwardedQuote(content);

      expect(result).toContain('<image filename="a.png">Image A</image>');
      expect(result).toContain('<image filename="b.png">Image B</image>');
      expect(result).toContain('<image filename="c.png">Image C</image>');
    });
  });

  describe('formatDedupedQuote', () => {
    it('prepends the referenced-message marker before a user reply-target preview', () => {
      const result = formatDedupedQuote({ from: 'Alice', role: 'user', content: 'some text' });
      expect(result).toContain('[Referenced message — full text in the chat log]');
      expect(result).toContain('some text');
      expect(result).toContain('role="user"');
    });

    it('renders a marker-only stub (no preview) when content is empty', () => {
      // The bot's-own-reply-target case: no self-preview to invite continuation.
      const result = formatDedupedQuote({ from: 'Lilith', role: 'assistant', content: '' });
      expect(result).toContain(
        '<content>[Referenced message — full text in the chat log]</content>'
      );
      expect(result).toContain('role="assistant"');
    });

    it('promises media only when media actually rides along', () => {
      // The marker is a claim about where to look. On a text-only stub, naming
      // media sends the model hunting for something that was never attached;
      // on a stub that carries descriptions, staying silent about them points
      // it at <chat_log>, where images exist only as URLs.
      const textOnly = formatDedupedQuote({ from: 'Alice', role: 'user', content: 'just words' });
      expect(textOnly).toContain('[Referenced message — full text in the chat log]');
      expect(textOnly).not.toContain('media');

      const withMedia = formatDedupedQuote({
        from: 'Alice',
        role: 'user',
        content: 'look at this',
        attachments: [{ kind: 'image', filename: 'a.png', description: 'a lighthouse at dusk' }],
      });
      expect(withMedia).toContain('its media is described here');
      expect(withMedia).toContain('<image filename="a.png">a lighthouse at dusk</image>');

      const withTranscript = formatDedupedQuote({
        from: 'Alice',
        role: 'user',
        content: '',
        attachments: [{ kind: 'voice', description: 'hey are you around' }],
      });
      expect(withTranscript).toContain('its media is described here');
    });

    it('names an undescribed attachment without claiming it is described', () => {
      // The two halves pull opposite ways and both matter. The attachment must
      // RENDER — an image with no description and no element is invisible, which
      // is the drop this whole shape exists to close. But the marker must NOT
      // promise a description, or the model goes looking for one that never
      // arrived and apologises for missing it.
      const result = formatDedupedQuote({
        from: 'Alice',
        role: 'user',
        content: 'check this',
        attachments: [{ kind: 'image', filename: 'unlucky.png', status: 'undescribed' }],
      });

      expect(result).toContain('<image filename="unlucky.png" status="undescribed"/>');
      expect(result).not.toContain('its media is described here');
      expect(result).toContain('[Referenced message — full text in the chat log]');
    });

    it('does NOT let long attachment markers truncate away the text preview', () => {
      // Regression: a reply-target with two long image-filename markers + short text. The
      // content is already text-capped upstream (buildDedupedReferenceStub); formatDedupedQuote
      // must render it WHOLE — re-truncating the combined markers+text left a misleading "I..."
      // that the model read as an unfinished sentence.
      const content =
        '[image/jpeg: SPOILER_PXL_20260701_221008932.jpg]\n' +
        '[image/jpeg: SPOILER_PXL_20260701_222104453.jpg]\n\n' +
        'I got myself off with this fucker';
      const result = formatDedupedQuote({ from: 'Lila', role: 'user', content });
      // The real text survives intact — no misleading 1-char "I..." fragment.
      expect(result).toContain('I got myself off with this fucker');
      expect(result).not.toContain('I...</content>');
    });
  });
});
