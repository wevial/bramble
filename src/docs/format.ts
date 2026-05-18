/**
 * Spec output format converters.
 *
 * The internal representation is always Markdown (agents produce find/replace
 * patches against Markdown text). These converters transform the final
 * Markdown body into XML, JSON, or HTML for the on-disk artifact.
 */

export type OutputFormat = 'md' | 'xml' | 'json' | 'html';

export const OUTPUT_FORMATS: readonly OutputFormat[] = ['md', 'xml', 'json', 'html'];

export function isOutputFormat(s: string): s is OutputFormat {
  return (OUTPUT_FORMATS as readonly string[]).includes(s);
}

/** File extension (without dot) for a given format. */
export function formatExtension(format: OutputFormat): string {
  return format === 'md' ? 'md' : format;
}

// ---------------------------------------------------------------------------
// Markdown → structured intermediate
// ---------------------------------------------------------------------------

type Section = {
  heading: string;
  level: number;
  content: string;
};

/**
 * Parse a Markdown spec into a flat list of sections. Each section starts at
 * a heading line (`# …`, `## …`, etc.) and its content runs until the next
 * heading of equal-or-higher level (or EOF). Text before the first heading
 * is captured as a level-0 section with an empty heading.
 */
export function parseSections(md: string): Section[] {
  if (!md.trim()) return [];
  const lines = md.split('\n');
  const sections: Section[] = [];
  let current: Section | null = null;
  const contentLines: string[] = [];

  const flush = (): void => {
    if (current) {
      current.content = contentLines.join('\n').trim();
      sections.push(current);
      contentLines.length = 0;
    }
  };

  for (const line of lines) {
    const match = line.match(/^(#{1,6})\s+(.*)/);
    if (match) {
      flush();
      current = { heading: match[2]!.trim(), level: match[1]!.length, content: '' };
    } else {
      if (!current) {
        // Text before any heading — create an implicit preamble section.
        current = { heading: '', level: 0, content: '' };
      }
      contentLines.push(line);
    }
  }
  flush();
  return sections;
}

// ---------------------------------------------------------------------------
// Converters
// ---------------------------------------------------------------------------

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Convert a Markdown content block to basic HTML paragraphs + lists. */
function contentToHtml(content: string): string {
  if (!content) return '';
  const lines = content.split('\n');
  const out: string[] = [];
  let inList = false;

  for (const line of lines) {
    const listMatch = line.match(/^[-*]\s+(.*)/);
    if (listMatch) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`  <li>${escapeHtml(listMatch[1]!)}</li>`);
    } else {
      if (inList) { out.push('</ul>'); inList = false; }
      const trimmed = line.trim();
      if (trimmed) {
        out.push(`<p>${escapeHtml(trimmed)}</p>`);
      }
    }
  }
  if (inList) out.push('</ul>');
  return out.join('\n');
}

export function toXml(md: string): string {
  const sections = parseSections(md);
  const lines: string[] = ['<?xml version="1.0" encoding="UTF-8"?>', '<spec>'];

  for (const s of sections) {
    if (s.level === 0) {
      if (s.content) lines.push(`  <preamble>${escapeXml(s.content)}</preamble>`);
      continue;
    }
    const tag = s.level === 1 ? 'title' : 'section';
    if (tag === 'title') {
      lines.push(`  <title>${escapeXml(s.heading)}</title>`);
      if (s.content) lines.push(`  <content>${escapeXml(s.content)}</content>`);
    } else {
      lines.push(`  <section heading="${escapeXml(s.heading)}" level="${s.level}">`);
      if (s.content) lines.push(`    <content>${escapeXml(s.content)}</content>`);
      lines.push('  </section>');
    }
  }
  lines.push('</spec>');
  return lines.join('\n');
}

export function toJson(md: string): string {
  const sections = parseSections(md);
  let title = '';
  let description = '';
  const body: { heading: string; level: number; content: string }[] = [];

  for (const s of sections) {
    if (s.level === 1 && !title) {
      title = s.heading;
      if (s.content) description = s.content;
    } else if (s.level === 0 && s.content) {
      body.push({ heading: '', level: 0, content: s.content });
    } else {
      body.push({ heading: s.heading, level: s.level, content: s.content });
    }
  }
  return JSON.stringify({ title, description, sections: body }, null, 2);
}

export function toHtml(md: string): string {
  const sections = parseSections(md);
  const lines: string[] = [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="UTF-8">',
  ];

  const titleSection = sections.find(s => s.level === 1);
  if (titleSection) {
    lines.push(`  <title>${escapeHtml(titleSection.heading)}</title>`);
  }

  lines.push('</head>', '<body>');

  for (const s of sections) {
    if (s.level === 0) {
      if (s.content) lines.push(contentToHtml(s.content));
      continue;
    }
    const h = `h${Math.min(s.level, 6)}`;
    lines.push(`<${h}>${escapeHtml(s.heading)}</${h}>`);
    if (s.content) lines.push(contentToHtml(s.content));
  }

  lines.push('</body>', '</html>');
  return lines.join('\n');
}

/**
 * Convert a Markdown spec body to the requested output format.
 * Returns the original markdown unchanged when format is 'md'.
 */
export function convertSpec(markdown: string, format: OutputFormat): string {
  switch (format) {
    case 'md':
      return markdown;
    case 'xml':
      return toXml(markdown);
    case 'json':
      return toJson(markdown);
    case 'html':
      return toHtml(markdown);
  }
}
