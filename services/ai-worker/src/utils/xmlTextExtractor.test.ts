import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return { ...actual, createLogger: () => mockLogger };
});

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: { NODE_ENV: 'test' as string, LOG_CONTENT_PREVIEWS: false },
}));
vi.mock('@tzurot/common-types/config/config', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/config/config')>(
    '@tzurot/common-types/config/config'
  );
  return { ...actual, getConfig: () => mockConfig };
});

import { extractXmlTextContent } from './xmlTextExtractor.js';

describe('extractXmlTextContent', () => {
  it('should extract text content from XML tags', () => {
    const xml = '<root><content>Hello world</content></root>';
    const result = extractXmlTextContent(xml);
    expect(result).toBe('Hello world');
  });

  it('should ignore attributes and tag names', () => {
    const xml =
      '<quote number="1"><author display_name="User" username="test"/><content>Message text</content></quote>';
    const result = extractXmlTextContent(xml);
    expect(result).toBe('Message text');
  });

  it('should extract multiple text nodes', () => {
    const xml = '<root><a>First</a><b>Second</b><c>Third</c></root>';
    const result = extractXmlTextContent(xml);
    expect(result).toContain('First');
    expect(result).toContain('Second');
    expect(result).toContain('Third');
  });

  it('should return empty string for empty input', () => {
    expect(extractXmlTextContent('')).toBe('');
    expect(extractXmlTextContent('   ')).toBe('');
  });

  it('should return empty string for structural-only XML', () => {
    const xml = `<contextual_references>
<quote number="1" from="User" username="user" role="user" t="2025-11-04 (Tue) 09:12 • 2 months ago">
<location type="guild">
<server name="Test Guild"/>
<channel name="general" type="text"/>
</location>
<image filename="photo.png" status="undescribed"/>
</quote>
</contextual_references>`;
    const result = extractXmlTextContent(xml);
    expect(result).toBe('');
  });

  it('should extract content from realistic reference XML', () => {
    const xml = `<contextual_references>
<quote number="1">
<author display_name="TestUser" username="testuser"/>
<content>Hello from the other side</content>
<attachments>
- Image (photo.png): A beautiful sunset
- Voice Message (5s): "Hey there"
</attachments>
</quote>
</contextual_references>`;
    const result = extractXmlTextContent(xml);
    expect(result).toContain('Hello from the other side');
    expect(result).toContain('A beautiful sunset');
    expect(result).toContain('Hey there');
  });

  it('should handle multi-line text content', () => {
    const xml = `<content>Line one
Line two
Line three</content>`;
    const result = extractXmlTextContent(xml);
    expect(result).toContain('Line one');
    expect(result).toContain('Line two');
    expect(result).toContain('Line three');
  });

  it('should handle XML entities', () => {
    const xml = '<content>5 &lt; 10 &amp; 10 &gt; 5</content>';
    const result = extractXmlTextContent(xml);
    expect(result).toContain('5 < 10 & 10 > 5');
  });

  it('should return empty string on malformed XML', () => {
    // fast-xml-parser is lenient, but severely broken input should not throw
    const result = extractXmlTextContent('<<<>>>');
    expect(typeof result).toBe('string');
  });

  describe('parse-failure warn log', () => {
    // An unterminated attribute value is a confirmed fast-xml-parser throw
    // (probed directly against the parser with this module's exact options).
    const unparseableXml = '<a attr="unterminated>text</a>';

    beforeEach(() => {
      mockLogger.warn.mockClear();
      mockConfig.NODE_ENV = 'test';
      mockConfig.LOG_CONTENT_PREVIEWS = false;
    });

    it('omits the xml preview by default, keeping the always-on length', () => {
      const result = extractXmlTextContent(unparseableXml);

      expect(result).toBe('');
      const call = mockLogger.warn.mock.calls[0];
      expect(call).toBeDefined();
      const fields = call?.[0] as Record<string, unknown>;
      expect(fields.xmlPreview).toBeUndefined();
      expect(fields.xmlLength).toBe(unparseableXml.length);
      expect(JSON.stringify(mockLogger.warn.mock.calls)).not.toContain(unparseableXml);
    });

    it('includes the xml preview when content previews are enabled', () => {
      mockConfig.NODE_ENV = 'development';
      mockConfig.LOG_CONTENT_PREVIEWS = true;

      extractXmlTextContent(unparseableXml);

      const call = mockLogger.warn.mock.calls[0];
      expect(call).toBeDefined();
      const fields = call?.[0] as Record<string, unknown>;
      expect(fields.xmlPreview).toBe(unparseableXml);
    });
  });
});
