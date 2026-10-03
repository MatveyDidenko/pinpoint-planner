import { join } from 'node:path';
import type { Assets } from '../core/render/page';

const CLIENT_DIR = join(import.meta.dir, '..', 'client');

type FontFace = { pkg: string; file: string; family: string; weight: number; style: 'normal' | 'italic' };

const FONT_FACES: readonly FontFace[] = [
  {
    pkg: 'ibm-plex-sans',
    file: 'ibm-plex-sans-latin-400-normal.woff2',
    family: 'IBM Plex Sans',
    weight: 400,
    style: 'normal',
  },
  {
    pkg: 'ibm-plex-sans',
    file: 'ibm-plex-sans-latin-600-normal.woff2',
    family: 'IBM Plex Sans',
    weight: 600,
    style: 'normal',
  },
  {
    pkg: 'ibm-plex-mono',
    file: 'ibm-plex-mono-latin-400-normal.woff2',
    family: 'IBM Plex Mono',
    weight: 400,
    style: 'normal',
  },
  {
    pkg: 'ibm-plex-mono',
    file: 'ibm-plex-mono-latin-500-normal.woff2',
    family: 'IBM Plex Mono',
    weight: 500,
    style: 'normal',
  },
  {
    pkg: 'source-serif-4',
    file: 'source-serif-4-latin-400-normal.woff2',
    family: 'Source Serif 4',
    weight: 400,
    style: 'normal',
  },
  {
    pkg: 'source-serif-4',
    file: 'source-serif-4-latin-400-italic.woff2',
    family: 'Source Serif 4',
    weight: 400,
    style: 'italic',
  },
  {
    pkg: 'source-serif-4',
    file: 'source-serif-4-latin-600-normal.woff2',
    family: 'Source Serif 4',
    weight: 600,
    style: 'normal',
  },
  {
    pkg: 'source-serif-4',
    file: 'source-serif-4-latin-600-italic.woff2',
    family: 'Source Serif 4',
    weight: 600,
    style: 'italic',
  },
];

export const FONT_FILES: Record<string, string> = Object.fromEntries(
  FONT_FACES.map(({ pkg, file }) => [file, Bun.fileURLToPath(import.meta.resolve(`@fontsource/${pkg}/files/${file}`))]),
);

export function fontCss(): string {
  return FONT_FACES.map(
    ({ file, family, weight, style }) =>
      `@font-face {\n  font-family: "${family}";\n  font-style: ${style};\n  font-weight: ${weight};\n  font-display: swap;\n  src: url(/fonts/${file}) format('woff2');\n}`,
  ).join('\n');
}

export const STUB_ASSETS: Assets = { css: '', fontCss: '', js: '' };

export async function buildClientAssets(): Promise<Assets> {
  const result = await Bun.build({
    entrypoints: [join(CLIENT_DIR, 'main.ts')],
    target: 'browser',
    format: 'iife',
    minify: true,
  });
  if (!result.success) {
    throw new Error(`client build failed:\n${result.logs.map((log) => String(log)).join('\n')}`);
  }
  const output = result.outputs[0];
  if (output === undefined) throw new Error('client build produced no output');
  const js = (await output.text()).replace(/<\/(script)/gi, '<\\/$1');
  const css = await Bun.file(join(CLIENT_DIR, 'styles.css')).text();
  return { css, fontCss: fontCss(), js };
}
