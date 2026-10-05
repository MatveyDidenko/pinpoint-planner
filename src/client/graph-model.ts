import {
  ARC_H,
  backPath,
  forwardPath,
  GAP_Y,
  type GraphLayout,
  measureLabel,
  NODE_H,
  PAD,
  round1,
} from '../core/diagram/layout';
import { renderLayoutSvg, STATUS_ORDER } from '../core/diagram/svg';
import type { GraphEdge, GraphNode } from '../core/schema';

// Mirror MAX_NODES, MAX_EDGES and the node label max in core/schema; importing them would bundle zod into the browser.
export const NODE_LIMIT = 8;
export const EDGE_LIMIT = 12;
export const LABEL_LIMIT = 40;

export type EditGraph = {
  nodes: (GraphNode & { x: number; y: number; w: number })[];
  edges: GraphEdge[];
};

type EditNode = EditGraph['nodes'][number];

export function addNode(g: EditGraph, label: string): EditGraph {
  if (g.nodes.length >= NODE_LIMIT) return g;
  let n = 1;
  while (g.nodes.some((node) => node.id === `n${n}`)) n++;
  const y = g.nodes.length === 0 ? PAD : Math.max(...g.nodes.map((node) => node.y + NODE_H)) + GAP_Y;
  const node: EditNode = { id: `n${n}`, label, status: 'new', x: PAD, y, w: measureLabel(label) };
  return { ...g, nodes: [...g.nodes, node] };
}

export function removeNode(g: EditGraph, id: string): EditGraph {
  // The schema rejects a graph with no nodes.
  if (g.nodes.length <= 1 || !g.nodes.some((node) => node.id === id)) return g;
  return {
    nodes: g.nodes.filter((node) => node.id !== id),
    edges: g.edges.filter((edge) => edge.from !== id && edge.to !== id),
  };
}

const joins = (edge: GraphEdge, from: string, to: string) => edge.from === from && edge.to === to;

export function connect(g: EditGraph, from: string, to: string): EditGraph {
  if (from === to || g.edges.length >= EDGE_LIMIT || g.edges.some((edge) => joins(edge, from, to))) return g;
  return { ...g, edges: [...g.edges, { from, to }] };
}

export function disconnect(g: EditGraph, from: string, to: string): EditGraph {
  const edges = g.edges.filter((edge) => !joins(edge, from, to));
  return edges.length === g.edges.length ? g : { ...g, edges };
}

function updateNode(g: EditGraph, id: string, change: (node: EditNode) => EditNode): EditGraph {
  if (!g.nodes.some((node) => node.id === id)) return g;
  return { ...g, nodes: g.nodes.map((node) => (node.id === id ? change(node) : node)) };
}

/** Relabels a box and pushes every box right of it along by however much it grew, so it never covers a neighbour. */
export function renameNode(g: EditGraph, id: string, label: string): EditGraph {
  const trimmed = label.trim();
  const renamed = g.nodes.find((node) => node.id === id);
  if (trimmed === '' || trimmed.length > LABEL_LIMIT || renamed === undefined) return g;
  const w = measureLabel(trimmed);
  const right = renamed.x + renamed.w;
  const grow = Math.max(0, w - renamed.w);
  const nodes = g.nodes.map((node) => {
    if (node.id === id) return { ...node, label: trimmed, w };
    return grow > 0 && node.x >= right ? { ...node, x: round1(node.x + grow) } : node;
  });
  return { ...g, nodes };
}

export function cycleStatus(g: EditGraph, id: string): EditGraph {
  const next = (status: EditNode['status']) =>
    STATUS_ORDER[(STATUS_ORDER.indexOf(status) + 1) % STATUS_ORDER.length] ?? status;
  return updateNode(g, id, (node) => ({ ...node, status: next(node.status) }));
}

/** Draws boxes where they were placed: focusable for the editor, or a static image when given an `ariaLabel`. */
export function renderEditableSvg(g: EditGraph, markerId: string, ariaLabel?: string): string {
  const edges: GraphLayout['edges'] = g.edges.map((edge) => {
    const from = g.nodes.find((node) => node.id === edge.from);
    const to = g.nodes.find((node) => node.id === edge.to);
    if (!from || !to) return { ...edge, path: '', back: false };
    const back = to.x < from.x + from.w;
    const path = back
      ? backPath(from.x + from.w / 2, from.y, to.x + to.w / 2, to.y)
      : forwardPath(from.x + from.w, from.y + NODE_H / 2, to.x, to.y + NODE_H / 2);
    return { ...edge, path, back };
  });
  const yOf = (id: string) => g.nodes.find((node) => node.id === id)?.y ?? 0;
  const arcTops = edges.filter((edge) => edge.back).map((edge) => Math.min(yOf(edge.from), yOf(edge.to)) - ARC_H - PAD);
  const top = round1(Math.min(0, ...arcTops));
  const width = round1(Math.max(0, ...g.nodes.map((node) => node.x + node.w)) + PAD);
  const height = round1(Math.max(0, ...g.nodes.map((node) => node.y + NODE_H)) + PAD - top);
  const nodes = g.nodes.map((node) => ({ ...node, h: NODE_H, layer: 0 }));
  const opts = ariaLabel === undefined ? { markerId, focusable: true } : { markerId, ariaLabel };
  return renderLayoutSvg({ top, width, height, nodes, edges }, opts);
}
