import { attr, esc } from '../render/esc';
import type { Graph, Status } from '../schema';
import { ARC_H, EDGE_LABEL_INSET, type GraphLayout, layoutGraph, NODE_H, round1 } from './layout';

export const STATUS_ORDER: readonly Status[] = ['reused', 'new', 'changed', 'external'];

const STATUS_LABELS: Record<Status, string> = {
  reused: 'Reused',
  new: 'New',
  changed: 'Changed',
  external: 'External',
};

function renderNode(node: GraphLayout['nodes'][number], focusable: boolean): string {
  const cx = round1(node.x + node.w / 2);
  const cy = round1(node.y + node.h / 2);
  const tabindex = focusable ? ' tabindex="0"' : '';
  return (
    `<g class="node node--${node.status}" data-node-id="${attr(node.id)}" data-node-label="${attr(node.label)}" data-node-status="${node.status}"${tabindex}>` +
    `<title>${esc(node.label)}</title>` +
    `<rect x="${node.x}" y="${node.y}" width="${node.w}" height="${node.h}" rx="8" style="fill:var(--diagram-${node.status})"/>` +
    `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central">${esc(node.label)}</text>` +
    `</g>`
  );
}

type LabelPoint = { x: number; y: number; anchor: 'middle' | 'end' };

// A forward label sits before the arrowhead on the far side of the arrival line, clear of its own curve.
function edgeLabelPoint(layout: GraphLayout, edge: GraphLayout['edges'][number]): LabelPoint | null {
  const from = layout.nodes.find((n) => n.id === edge.from);
  const to = layout.nodes.find((n) => n.id === edge.to);
  if (!from || !to) return null;
  if (edge.back) {
    const ceiling = Math.min(from.y, to.y) - ARC_H;
    const x = round1((from.x + from.w / 2 + to.x + to.w / 2) / 2);
    return { x, y: round1((from.y + to.y + 6 * ceiling) / 8 - 4), anchor: 'middle' };
  }
  const arrival = to.y + NODE_H / 2;
  return { x: round1(to.x - EDGE_LABEL_INSET), y: round1(to.y > from.y ? arrival + 14 : arrival - 6), anchor: 'end' };
}

function renderEdge(layout: GraphLayout, edge: GraphLayout['edges'][number], markerId: string): string {
  if (edge.path === '') return '';
  const cls = `edge${edge.back ? ' edge--back' : ''}${edge.guess ? ' edge--guess' : ''}`;
  const labelAttr = edge.label === undefined ? '' : ` data-edge-label="${attr(edge.label)}"`;
  const guessAttr = edge.guess ? ' data-guess=""' : '';
  const path =
    `<path class="${cls}" data-from="${attr(edge.from)}" data-to="${attr(edge.to)}"${labelAttr}${guessAttr} ` +
    `d="${attr(edge.path)}" marker-end="url(#${attr(markerId)})"/>`;
  const point = edge.label === undefined ? null : edgeLabelPoint(layout, edge);
  if (edge.label === undefined || point === null) return path;
  return `${path}<text class="edge-label" x="${point.x}" y="${point.y}" text-anchor="${point.anchor}">${esc(edge.label)}</text>`;
}

export function renderLayoutSvg(
  layout: GraphLayout,
  opts: { markerId: string; ariaLabel?: string; focusable?: boolean },
): string {
  const marker =
    `<defs><marker id="${attr(opts.markerId)}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">` +
    `<path class="arrow" d="M0 0L10 5L0 10z"/></marker></defs>`;
  const edges = layout.edges.map((edge) => renderEdge(layout, edge, opts.markerId)).join('');
  const nodes = layout.nodes.map((node) => renderNode(node, opts.focusable === true)).join('');
  const aria = opts.ariaLabel === undefined ? '' : ` role="img" aria-label="${attr(opts.ariaLabel)}"`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg"${aria} ` +
    `viewBox="0 ${layout.top ?? 0} ${layout.width} ${layout.height}" width="${layout.width}" height="${layout.height}">` +
    `${marker}${edges}${nodes}</svg>`
  );
}

export function renderGraphSvg(g: Graph, opts: { markerId: string; ariaLabel: string }): string {
  return renderLayoutSvg(layoutGraph(g), opts);
}

export function renderLegend(g: Graph): string {
  const present = new Set(g.nodes.map((node) => node.status));
  const items = STATUS_ORDER.filter((status) => present.has(status))
    .map(
      (status) =>
        `<li data-status="${status}"><span class="legend-swatch" style="background:var(--diagram-${status})"></span>${STATUS_LABELS[status]}</li>`,
    )
    .join('');
  const guess = g.edges.some((edge) => edge.guess)
    ? '<li data-guess=""><span class="legend-guess"></span>Guessed arrow, not checked</li>'
    : '';
  return `<ul class="legend">${items}${guess}</ul>`;
}
