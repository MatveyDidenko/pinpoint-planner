const HTML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const JSON_ESCAPES: Record<string, string> = {
  '<': '\\u003c',
  '>': '\\u003e',
  '&': '\\u0026',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029',
};

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ENTITIES[c] ?? c);
}

export function attr(s: string): string {
  return esc(s);
}

export function jsonScript(v: unknown): string {
  return JSON.stringify(v).replace(/[<>&\u2028\u2029]/g, (c) => JSON_ESCAPES[c] ?? c);
}
