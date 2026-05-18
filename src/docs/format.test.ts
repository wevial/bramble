import { describe, it, expect } from 'vitest';
import {
  type OutputFormat,
  isOutputFormat,
  formatExtension,
  parseSections,
  convertSpec,
  toXml,
  toJson,
  toHtml,
} from './format.js';

const SAMPLE_MD = [
  '# Auth Spec',
  '',
  '## Goals',
  'A minimal auth system.',
  '',
  '## Threat Model',
  '- Credential stuffing: rate-limit.',
  '- Session hijacking: short-lived tokens.',
].join('\n');

describe('isOutputFormat', () => {
  it('accepts valid formats', () => {
    for (const f of ['md', 'xml', 'json', 'html']) {
      expect(isOutputFormat(f)).toBe(true);
    }
  });

  it('rejects invalid strings', () => {
    expect(isOutputFormat('pdf')).toBe(false);
    expect(isOutputFormat('')).toBe(false);
    expect(isOutputFormat('XML')).toBe(false);
  });
});

describe('formatExtension', () => {
  it('returns the format string as extension', () => {
    expect(formatExtension('md')).toBe('md');
    expect(formatExtension('xml')).toBe('xml');
    expect(formatExtension('json')).toBe('json');
    expect(formatExtension('html')).toBe('html');
  });
});

describe('parseSections', () => {
  it('splits headings and content', () => {
    const sections = parseSections(SAMPLE_MD);
    expect(sections.length).toBe(3);
    expect(sections[0]!.heading).toBe('Auth Spec');
    expect(sections[0]!.level).toBe(1);
    expect(sections[1]!.heading).toBe('Goals');
    expect(sections[1]!.level).toBe(2);
    expect(sections[1]!.content).toBe('A minimal auth system.');
    expect(sections[2]!.heading).toBe('Threat Model');
    expect(sections[2]!.level).toBe(2);
    expect(sections[2]!.content).toContain('Credential stuffing');
  });

  it('captures preamble text before first heading', () => {
    const md = 'Some preamble text.\n\n# Title\nBody.';
    const sections = parseSections(md);
    expect(sections[0]!.level).toBe(0);
    expect(sections[0]!.heading).toBe('');
    expect(sections[0]!.content).toBe('Some preamble text.');
  });

  it('handles empty input', () => {
    expect(parseSections('')).toEqual([]);
  });
});

describe('convertSpec', () => {
  it('returns markdown unchanged for md format', () => {
    expect(convertSpec(SAMPLE_MD, 'md')).toBe(SAMPLE_MD);
  });

  it('delegates to the correct converter', () => {
    expect(convertSpec(SAMPLE_MD, 'xml')).toBe(toXml(SAMPLE_MD));
    expect(convertSpec(SAMPLE_MD, 'json')).toBe(toJson(SAMPLE_MD));
    expect(convertSpec(SAMPLE_MD, 'html')).toBe(toHtml(SAMPLE_MD));
  });
});

describe('toXml', () => {
  it('produces well-formed XML with spec root', () => {
    const xml = toXml(SAMPLE_MD);
    expect(xml).toMatch(/^<\?xml version="1\.0"/);
    expect(xml).toContain('<spec>');
    expect(xml).toContain('</spec>');
    expect(xml).toContain('<title>Auth Spec</title>');
    expect(xml).toContain('heading="Goals"');
    expect(xml).toContain('heading="Threat Model"');
  });

  it('escapes special characters', () => {
    const md = '# A & B\n\n## <Section>\nContent with "quotes" & \'apos\'.';
    const xml = toXml(md);
    expect(xml).toContain('A &amp; B');
    expect(xml).toContain('&lt;Section&gt;');
    expect(xml).toContain('&quot;quotes&quot;');
    expect(xml).toContain('&apos;apos&apos;');
  });
});

describe('toJson', () => {
  it('produces valid JSON with title and sections', () => {
    const result = JSON.parse(toJson(SAMPLE_MD));
    expect(result.title).toBe('Auth Spec');
    expect(result.description).toBe('');
    expect(Array.isArray(result.sections)).toBe(true);
    expect(result.sections.length).toBe(2);
    expect(result.sections[0].heading).toBe('Goals');
    expect(result.sections[1].heading).toBe('Threat Model');
  });

  it('includes content in sections', () => {
    const result = JSON.parse(toJson(SAMPLE_MD));
    expect(result.sections[0].content).toBe('A minimal auth system.');
    expect(result.sections[1].content).toContain('Credential stuffing');
  });

  it('hoists level-1 body text to description instead of sections', () => {
    const md = '# My Spec\nIntro paragraph.\n\n## Details\nSome details.';
    const result = JSON.parse(toJson(md));
    expect(result.title).toBe('My Spec');
    expect(result.description).toBe('Intro paragraph.');
    expect(result.sections.length).toBe(1);
    expect(result.sections[0].heading).toBe('Details');
  });
});

describe('toHtml', () => {
  it('produces an HTML document', () => {
    const html = toHtml(SAMPLE_MD);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('</html>');
    expect(html).toContain('<title>Auth Spec</title>');
  });

  it('renders headings with correct level', () => {
    const html = toHtml(SAMPLE_MD);
    expect(html).toContain('<h1>Auth Spec</h1>');
    expect(html).toContain('<h2>Goals</h2>');
    expect(html).toContain('<h2>Threat Model</h2>');
  });

  it('renders bullet lists as <ul>/<li>', () => {
    const html = toHtml(SAMPLE_MD);
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>Credential stuffing: rate-limit.</li>');
    expect(html).toContain('<li>Session hijacking: short-lived tokens.</li>');
    expect(html).toContain('</ul>');
  });

  it('escapes HTML entities in content', () => {
    const md = '# A <script>alert("xss")</script>\n\nSafe & sound.';
    const html = toHtml(md);
    expect(html).toContain('&lt;script&gt;alert("xss")&lt;/script&gt;');
    expect(html).toContain('Safe &amp; sound.');
  });
});
