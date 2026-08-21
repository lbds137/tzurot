import { describe, it, expect } from 'vitest';
import {
  buildRenderableAttachments,
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

    it('should order elements correctly: content → location → embeds → attachments', () => {
      const result = formatQuoteElement({
        number: 1,
        from: 'User',
        timeFormatted: '2025-01-01 (Wed) 09:00 • now',
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

    it('should include the channel attribute, escaped, after t', () => {
      const result = formatQuoteElement({
        from: 'User',
        timeFormatted: '2025-01-01 (Wed) 09:00 • now',
        channel: 'general & <sneaky>',
        content: 'Hello',
      });

      expect(result).toContain('channel="general &amp; &lt;sneaky&gt;"');
      const tPos = result.indexOf('t=');
      const channelPos = result.indexOf('channel=');
      expect(channelPos).toBeGreaterThan(tPos);
    });

    it('should omit the channel attribute entirely when absent', () => {
      const result = formatQuoteElement({
        from: 'User',
        content: 'Hello',
      });

      expect(result).not.toContain('channel=');
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

    it('should attribute the forward when the origin was recovered', () => {
      const content: ForwardedMessageContent = {
        from: 'COLD',
        fromId: '1472768398135001108',
        timeFormatted: '2026-08-18 (Tue) 11:13',
        textContent: 'Hello from the other channel',
      };

      const result = formatForwardedQuote(content);

      expect(result).toBe(
        '<quote type="forward" from="COLD" from_id="1472768398135001108" ' +
          't="2026-08-18 (Tue) 11:13">\n' +
          '<content>Hello from the other channel</content>\n' +
          '</quote>'
      );
    });

    it('forwards the channel name onto the rendered quote', () => {
      const content: ForwardedMessageContent = {
        from: 'COLD',
        timeFormatted: '2026-08-18 (Tue) 11:13',
        channel: 'general',
        textContent: 'Hello from the other channel',
      };

      const result = formatForwardedQuote(content);

      expect(result).toContain('channel="general"');
    });

    it('keeps the timestamp when only the author could not be recovered', () => {
      // The snapshot carries a timestamp but never an author, so a deleted or
      // unreadable original leaves exactly this half-resolved shape.
      const result = formatForwardedQuote({
        timeFormatted: '2026-08-18 (Tue) 11:13',
        textContent: 'Hello from the other channel',
      });

      expect(result).toContain('from="Unknown"');
      expect(result).toContain('t="2026-08-18 (Tue) 11:13"');
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
      };

      const result = formatForwardedQuote(content);

      // Verify all sections present and ordered
      const sections = [
        '<quote type="forward"',
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

  describe('buildRenderableAttachments', () => {
    const image = { url: 'https://cdn/photo.png', name: 'photo.png', contentType: 'image/png' };
    const voice = {
      url: 'https://cdn/clip.ogg',
      name: 'clip.ogg',
      contentType: 'audio/ogg',
      isVoiceMessage: true,
      duration: 7,
    };
    const music = { url: 'https://cdn/song.mp3', name: 'song.mp3', contentType: 'audio/mpeg' };
    const doc = {
      url: 'https://cdn/report.pdf',
      name: 'report.pdf',
      contentType: 'application/pdf',
    };

    const none = (): string | undefined => undefined;

    /** The renderable half — what these cases are about. */
    const rendered = <T extends { attachment: unknown }>(built: T[]): unknown[] =>
      built.map(entry => entry.attachment);

    it('pairs each attachment with the enrichment the caller finds for it', () => {
      const built = buildRenderableAttachments([image, voice], att =>
        att.name === 'photo.png' ? 'a cat' : 'hello there'
      );

      expect(rendered(built)).toEqual([
        { kind: 'image', filename: 'photo.png', contentType: 'image/png', description: 'a cat' },
        {
          kind: 'voice',
          filename: 'clip.ogg',
          contentType: 'audio/ogg',
          durationSeconds: 7,
          description: 'hello there',
        },
      ]);
    });

    it('names the absence per modality rather than emitting a bare element', () => {
      expect(rendered(buildRenderableAttachments([image, voice], none))).toEqual([
        { kind: 'image', filename: 'photo.png', contentType: 'image/png', status: 'undescribed' },
        {
          kind: 'voice',
          filename: 'clip.ogg',
          contentType: 'audio/ogg',
          durationSeconds: 7,
          status: 'untranscribed',
        },
      ]);
    });

    it('treats an empty description as absent — a silent clip is not a transcript', () => {
      expect(rendered(buildRenderableAttachments([voice], () => ''))).toEqual([
        {
          kind: 'voice',
          filename: 'clip.ogg',
          contentType: 'audio/ogg',
          durationSeconds: 7,
          status: 'untranscribed',
        },
      ]);
    });

    it('keeps duration on a voice message whether or not a transcript arrived', () => {
      const [transcribed] = buildRenderableAttachments([voice], () => 'hi');
      const [silent] = buildRenderableAttachments([voice], none);

      expect(transcribed.attachment).toMatchObject({ durationSeconds: 7 });
      expect(silent.attachment).toMatchObject({ durationSeconds: 7 });
    });

    it('classifies on isVoiceMessage, not on audio/* — a music file is not a failed transcript', () => {
      expect(rendered(buildRenderableAttachments([music], none))).toEqual([
        { kind: 'file', filename: 'song.mp3', contentType: 'audio/mpeg' },
      ]);
    });

    it('renders a plain file with no enrichment slot at all', () => {
      // Deliberate: nothing describes a .zip, so the union gives RenderableFile
      // no description field. A caller that finds enrichment for one is warned
      // by its own count check (see warnOnDroppedEnrichment) rather than
      // silently misrendering it.
      expect(rendered(buildRenderableAttachments([doc], () => 'a quarterly report'))).toEqual([
        { kind: 'file', filename: 'report.pdf', contentType: 'application/pdf' },
      ]);
    });

    it('omits the filename entirely when there is no real name', () => {
      const [built] = buildRenderableAttachments(
        [{ url: 'https://cdn/nameless.png', contentType: 'image/png' }],
        () => 'a cat'
      );

      expect(built.attachment).toEqual({
        kind: 'image',
        contentType: 'image/png',
        description: 'a cat',
      });
      expect(renderAttachment(built.attachment)).toBe('<image type="image/png">a cat</image>');
    });

    it('pairs every element with the URL of the attachment it came from', () => {
      // The URL is not rendered — it is the key the built enrichment is written
      // down under, so a description the model saw can be replayed tomorrow.
      const built = buildRenderableAttachments([image, doc], () => 'a cat');

      expect(built.map(entry => entry.url)).toEqual([
        'https://cdn/photo.png',
        'https://cdn/report.pdf',
      ]);
    });
  });
});
