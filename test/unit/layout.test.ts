import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { layoutGraph, measureLabel } from '../../src/core/diagram/layout';
import type { Graph } from '../../src/core/schema';

const raw = JSON.parse(readFileSync(join(import.meta.dir, '..', 'fixtures', 'plan.auth-refresh.json'), 'utf8'));

function diagramOf(optionId: string): Graph {
  return raw.options.find((o: { id: string }) => o.id === optionId).diagram;
}

function summarise(g: Graph) {
  const layout = layoutGraph(g);
  return {
    width: layout.width,
    height: layout.height,
    nodes: Object.fromEntries(layout.nodes.map((n) => [n.id, { layer: n.layer, x: n.x, y: n.y, w: n.w, h: n.h }])),
    layout,
  };
}

function lcg(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function generateDag(next: () => number): Graph {
  const count = 1 + Math.floor(next() * 8);
  const nodes = Array.from({ length: count }, (_, i) => ({
    id: `n${i}`,
    label: 'x'.repeat(1 + Math.floor(next() * 40)),
    status: 'new' as const,
  }));
  const edges: Graph['edges'] = [];
  for (let from = 0; from < count; from++) {
    for (let to = from + 1; to < count; to++) {
      if (next() < 0.35) edges.push({ from: `n${from}`, to: `n${to}` });
    }
  }
  return { nodes, edges };
}

describe('measureLabel', () => {
  it('clamps between 72 and 306', () => {
    expect(measureLabel('a')).toBe(72);
    expect(measureLabel('Fetch wrapper')).toBe(111.6);
    expect(measureLabel('x'.repeat(40))).toBe(306);
  });
});

describe('layoutGraph', () => {
  it('fixture graphs get the expected layers and coordinates', () => {
    const a = summarise(diagramOf('opt-a'));
    expect(a.width).toBe(630);
    expect(a.height).toBe(134);
    expect(a.nodes).toEqual({
      caller: { layer: 0, x: 24, y: 24, w: 82.8, h: 34 },
      wrapper: { layer: 1, x: 162.8, y: 24, w: 111.6, h: 34 },
      refresh: { layer: 2, x: 334, y: 24, w: 104.4, h: 34 },
      api: { layer: 2, x: 334, y: 76, w: 72, h: 34 },
      session: { layer: 3, x: 494.4, y: 24, w: 111.6, h: 34 },
    });
    expect(a.layout.edges.map((e) => e.back)).toEqual([false, false, false, false]);
    expect(a.layout.edges[0]?.path).toBe('M106.8 41C134.8 41 134.8 41 162.8 41');
    expect(a.layout.edges[1]?.path).toBe('M274.4 41C304.2 41 304.2 93 334 93');

    const b = summarise(diagramOf('opt-b'));
    expect(b.width).toBe(705);
    expect(b.height).toBe(174);
    expect(b.nodes).toEqual({
      timer: { layer: 0, x: 24, y: 64, w: 111.6, h: 34 },
      refresh: { layer: 1, x: 241.4, y: 64, w: 104.4, h: 34 },
      storage: { layer: 2, x: 401.8, y: 64, w: 111.6, h: 34 },
      session: { layer: 3, x: 569.4, y: 64, w: 111.6, h: 34 },
      wrapper: { layer: 0, x: 24, y: 116, w: 111.6, h: 34 },
    });
    expect(b.layout.edges.map((e) => e.back)).toEqual([false, false, false, true, false]);
    expect(b.layout.edges[3]?.path).toBe('M625.2 64C625.2 24 79.8 24 79.8 64');
    expect(b.layout.edges[0]?.path).toBe('M135.6 81C188.5 81 188.5 81 241.4 81');
  });

  it('a cycle does not throw and marks exactly one edge back', () => {
    const cycle: Graph = {
      nodes: [
        { id: 'a', label: 'Alpha', status: 'new' },
        { id: 'b', label: 'Beta', status: 'new' },
        { id: 'c', label: 'Gamma', status: 'new' },
      ],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
        { from: 'c', to: 'a' },
      ],
    };
    const layout = layoutGraph(cycle);
    expect(layout.edges.filter((e) => e.back).map((e) => `${e.from}>${e.to}`)).toEqual(['c>a']);
    expect(layout.nodes.map((n) => n.layer)).toEqual([0, 1, 2]);
    expect(layout.height).toBe(24 + 40 + 34 + 24);
  });

  it('generated DAGs keep every node inside the canvas with no overlapping rects', () => {
    const next = lcg(7);
    for (let i = 0; i < 20; i++) {
      const graph = generateDag(next);
      const layout = layoutGraph(graph);
      expect(layoutGraph(graph)).toEqual(layout);
      expect(layout.nodes).toHaveLength(graph.nodes.length);
      expect(layout.edges).toHaveLength(graph.edges.length);
      expect(layout.edges.some((e) => e.back)).toBe(false);
      for (const n of layout.nodes) {
        expect(n.x).toBeGreaterThanOrEqual(24);
        expect(n.y).toBeGreaterThanOrEqual(24);
        expect(n.x + n.w).toBeLessThanOrEqual(layout.width - 24);
        expect(n.y + n.h).toBeLessThanOrEqual(layout.height - 24);
      }
      for (const [j, p] of layout.nodes.entries()) {
        for (const q of layout.nodes.slice(j + 1)) {
          const apart = p.x + p.w <= q.x || q.x + q.w <= p.x || p.y + p.h <= q.y || q.y + q.h <= p.y;
          expect(apart).toBe(true);
        }
      }
    }
  });
});
