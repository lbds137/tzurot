import { describe, it, expect } from 'vitest';
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
<quote number="1">
<author display_name="User" username="user"/>
<location type="guild">
<server name="Test Guild"/>
<channel name="general" type="text"/>
</location>
<time absolute="Mon, Nov 4, 2025" relative="2 months ago"/>
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

  it('should filter out "Author unavailable" lines', () => {
    const xml = '<root><content>Author unavailable</content><content>Real content</content></root>';
    const result = extractXmlTextContent(xml);
    expect(result).not.toContain('Author unavailable');
    expect(result).toContain('Real content');
  });
});
