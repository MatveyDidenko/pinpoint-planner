import type { Graph, GraphEdge, GraphNode } from '../schema';

export type GraphLayout = {
  top?: number;
  width: number;
  height: number;
  nodes: Array<GraphNode & { x: number; y: number; w: number; h: number; layer: number }>;
  edges: Array<GraphEdge & { path: string; back: boolean }>;
};

export const NODE_H = 34;
export const GAP_X = 56;
export const GAP_Y = 18;
export const PAD = 24;
export const ARC_H = 40;

const MIN_NODE_W = 72;
const MAX_NODE_W = 306;
const EDGE_CHAR_W = 6.6;
export const EDGE_LABEL_INSET = 12;

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function measureLabel(label: string): number {
  return round1(Math.min(MAX_NODE_W, Math.max(MIN_NODE_W, 18 + 7.2 * label.length)));
}

function gapForLabel(label: string): number {
  return round1(EDGE_CHAR_W * label.length + EDGE_LABEL_INSET + 8);
}

/** Flags each edge that closes a cycle, found by DFS from nodes in input order over out-edges in input order. */
function findBackEdges(g: Graph): boolean[] {
  const outEdges = new Map<string, number[]>();
  g.edges.forEach((edge, i) => {
    outEdges.set(edge.from, [...(outEdges.get(edge.from) ?? []), i]);
  });
  const back = g.edges.map(() => false);
  const visited = new Set<string>();
  const onStack = new Set<string>();

  const visit = (id: string): void => {
    visited.add(id);
    onStack.add(id);
    for (const i of outEdges.get(id) ?? []) {
      const target = g.edges[i]?.to;
      if (target === undefined) continue;
      if (onStack.has(target)) back[i] = true;
      else if (!visited.has(target)) visit(target);
    }
    onStack.delete(id);
  };

  for (const node of g.nodes) if (!visited.has(node.id)) visit(node.id);
  return back;
}

function longestPathLayers(g: Graph, back: readonly boolean[]): Map<string, number> {
  const incoming = new Map<string, string[]>();
  g.edges.forEach((edge, i) => {
    if (!back[i]) incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge.from]);
  });
  const layers = new Map<string, number>();
  const layerOf = (id: string): number => {
    const known = layers.get(id);
    if (known !== undefined) return known;
    const layer = Math.max(-1, ...(incoming.get(id) ?? []).map(layerOf)) + 1;
    layers.set(id, layer);
    return layer;
  };
  for (const node of g.nodes) layerOf(node.id);
  return layers;
}

export function forwardPath(x1: number, y1: number, x2: number, y2: number): string {
  const mid = round1((x1 + x2) / 2);
  return `M${round1(x1)} ${round1(y1)}C${mid} ${round1(y1)} ${mid} ${round1(y2)} ${round1(x2)} ${round1(y2)}`;
}

export function backPath(x1: number, y1: number, x2: number, y2: number): string {
  const ceiling = round1(Math.min(y1, y2) - ARC_H);
  return `M${round1(x1)} ${round1(y1)}C${round1(x1)} ${ceiling} ${round1(x2)} ${ceiling} ${round1(x2)} ${round1(y2)}`;
}

/**
 * Lays a graph out left to right in longest-path layers.
 *
 * Edges that close a cycle are marked `back`, ignored for layering, and drawn as an arc above both nodes. Column x
 * is PAD plus each earlier layer's widest node and the gap before each layer, which is GAP_X or wider to fit the
 * labels of forward edges ending in that layer; nodes stack top-down from PAD in input order, shifted down by ARC_H
 * when any back edge exists.
 */
export function layoutGraph(g: Graph): GraphLayout {
  const backFlags = findBackEdges(g);
  const layers = longestPathLayers(g, backFlags);
  const layerCount = Math.max(...layers.values()) + 1;
  const hasBack = backFlags.some(Boolean);
  const top = PAD + (hasBack ? ARC_H : 0);

  const columns: GraphNode[][] = Array.from({ length: layerCount }, () => []);
  for (const node of g.nodes) columns[layers.get(node.id) ?? 0]?.push(node);
  const gaps = columns.map(() => GAP_X);
  g.edges.forEach((edge, i) => {
    const layer = layers.get(edge.to) ?? 0;
    if (edge.label === undefined || backFlags[i]) return;
    gaps[layer] = Math.max(gaps[layer] ?? GAP_X, gapForLabel(edge.label));
  });

  const nodes: GraphLayout['nodes'] = [];
  let x = PAD;
  let tallest = 0;
  for (const [layer, column] of columns.entries()) {
    if (layer > 0) x += gaps[layer] ?? GAP_X;
    let y = top;
    let widest = 0;
    for (const node of column) {
      const w = measureLabel(node.label);
      nodes.push({ ...node, x: round1(x), y: round1(y), w, h: NODE_H, layer });
      y += NODE_H + GAP_Y;
      widest = Math.max(widest, w);
    }
    tallest = Math.max(tallest, y - GAP_Y);
    x += widest;
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges: GraphLayout['edges'] = g.edges.map((edge, i) => {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) return { ...edge, path: '', back: false };
    if (backFlags[i]) {
      return { ...edge, back: true, path: backPath(from.x + from.w / 2, from.y, to.x + to.w / 2, to.y) };
    }
    return { ...edge, back: false, path: forwardPath(from.x + from.w, from.y + NODE_H / 2, to.x, to.y + NODE_H / 2) };
  });

  return { width: round1(x + PAD), height: round1(tallest + PAD), nodes, edges };
}
