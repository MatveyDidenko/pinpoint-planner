import { esc } from './render/esc';

const CODE_SPAN = /(`[^`\n]+`)/;
const LINK = /(?<!!)\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g;
const BOLD = /\*\*(?=\S)(.+?)(?<=\S)\*\*/g;
const ITALIC = /\*(?=\S)([^*\n]+?)(?<=\S)\*/g;
const BULLET = /^- /;
const NUMBERED = /^\d+\. /;

function emphasis(text: string): string {
  return text.replace(BOLD, '<strong>$1</strong>').replace(ITALIC, '<em>$1</em>');
}

// The href is already attribute-safe because the whole input is escaped before this runs.
function linksAndEmphasis(text: string): string {
  let out = '';
  let last = 0;
  for (const m of text.matchAll(LINK)) {
    out += emphasis(text.slice(last, m.index));
    out += `<a href="${m[2]}" target="_blank" rel="noopener noreferrer">${emphasis(m[1] ?? '')}</a>`;
    last = m.index + m[0].length;
  }
  return out + emphasis(text.slice(last));
}

function inline(escaped: string): string {
  return escaped
    .split(CODE_SPAN)
    .map((part, i) => (i % 2 === 1 ? `<code>${part.slice(1, -1)}</code>` : linksAndEmphasis(part)))
    .join('');
}

function renderBlock(block: string): string {
  const lines = block.split('\n');
  if (lines.every((l) => BULLET.test(l))) {
    return `<ul>${lines.map((l) => `<li>${inline(l.replace(BULLET, ''))}</li>`).join('')}</ul>`;
  }
  if (lines.every((l) => NUMBERED.test(l))) {
    return `<ol>${lines.map((l) => `<li>${inline(l.replace(NUMBERED, ''))}</li>`).join('')}</ol>`;
  }
  return `<p>${lines.map(inline).join('<br>')}</p>`;
}

/** Escapes the whole input first, so every `<` in the output comes from a tag this module emits. */
export function renderMarkdown(md: string): string {
  const escaped = esc(md.replace(/\r\n?/g, '\n'));
  return escaped
    .split(/\n[ \t]*\n/)
    .map((b) => b.trim())
    .filter((b) => b !== '')
    .map(renderBlock)
    .join('');
}
