import { describe, expect, it } from 'bun:test';
import { buildClientAssets, FONT_FILES, fontCss, STUB_ASSETS } from '../../src/server/assets';

describe('buildClientAssets', () => {
  it('resolves with non-empty js that contains no </script', async () => {
    const assets = await buildClientAssets();
    expect(assets.js.length).toBeGreaterThan(0);
    expect(assets.js.toLowerCase()).not.toContain('</script');
    expect(assets.css.length).toBeGreaterThan(0);
  });

  it('css contains the proposal tokens and a prefers-reduced-motion rule', async () => {
    const { css } = await buildClientAssets();
    for (const token of [
      '--ground',
      '--surface',
      '--sunken',
      '--ink',
      '--muted',
      '--faint',
      '--line',
      '--accent',
      '--accent-soft',
      '--hold',
      '--hold-soft',
      '--shadow',
    ]) {
      expect(css).toContain(`${token}:`);
    }
    expect(css).toContain('color-scheme: light dark');
    expect(css).toContain('prefers-color-scheme: dark');
    expect(css).toContain(':root[data-theme="dark"]');
    expect(css).toContain('prefers-reduced-motion: reduce');
  });

  it('STUB_ASSETS is all empty strings', () => {
    expect(STUB_ASSETS).toEqual({ css: '', fontCss: '', js: '' });
  });

  it('every FONT_FILES path exists on disk and fontCss references each one', async () => {
    const names = Object.keys(FONT_FILES).sort();
    expect(names).toEqual(
      [
        'ibm-plex-mono-latin-400-normal.woff2',
        'ibm-plex-mono-latin-500-normal.woff2',
        'ibm-plex-sans-latin-400-normal.woff2',
        'ibm-plex-sans-latin-600-normal.woff2',
        'source-serif-4-latin-400-italic.woff2',
        'source-serif-4-latin-400-normal.woff2',
        'source-serif-4-latin-600-italic.woff2',
        'source-serif-4-latin-600-normal.woff2',
      ].sort(),
    );
    const css = fontCss();
    for (const name of names) {
      const path = FONT_FILES[name] as string;
      expect(path.startsWith('/')).toBe(true);
      expect(await Bun.file(path).exists()).toBe(true);
      expect(css).toContain(`src: url(/fonts/${name}) format('woff2')`);
    }
    expect(css.match(/@font-face/g)?.length).toBe(names.length);
    expect((await buildClientAssets()).fontCss).toBe(css);
  });

  it('fontCss declares italic only for the serif family', () => {
    const blocks = fontCss()
      .split('@font-face')
      .slice(1)
      .map((block) => ({
        family: /font-family: "([^"]+)"/.exec(block)?.[1],
        style: /font-style: (\w+)/.exec(block)?.[1],
      }));
    expect(blocks.length).toBe(8);
    const italic = blocks.filter((block) => block.style === 'italic');
    expect(italic.length).toBe(2);
    expect(italic.every((block) => block.family === 'Source Serif 4')).toBe(true);
    expect(blocks.filter((block) => block.family !== 'Source Serif 4').every((block) => block.style === 'normal')).toBe(
      true,
    );
  });
});
