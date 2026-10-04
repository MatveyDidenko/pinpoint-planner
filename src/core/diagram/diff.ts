import type { Graph, GraphEdge } from '../schema';

const edgeKey = (edge: GraphEdge) => `${edge.from}→${edge.to}`;

const quoted = (label: string | undefined) => (label ? `"${label}"` : 'no label');

export function diffGraphs(before: Graph, after: Graph): string[] {
  const beforeNodes = new Map(before.nodes.map((node) => [node.id, node]));
  const afterNodes = new Map(after.nodes.map((node) => [node.id, node]));
  const beforeEdges = new Map(before.edges.map((edge) => [edgeKey(edge), edge]));
  const afterEdges = new Map(after.edges.map((edge) => [edgeKey(edge), edge]));
  const name = (id: string) => afterNodes.get(id)?.label ?? beforeNodes.get(id)?.label ?? id;
  const arrow = (edge: GraphEdge) => `${name(edge.from)} → ${name(edge.to)}`;
  const kept = after.nodes.flatMap((node) => {
    const old = beforeNodes.get(node.id);
    return old ? [{ old, node }] : [];
  });
  const keptEdges = after.edges.flatMap((edge) => {
    const old = beforeEdges.get(edgeKey(edge));
    return old ? [{ old, edge }] : [];
  });

  return [
    ...before.nodes.filter((node) => !afterNodes.has(node.id)).map((node) => `removed box ${node.label}`),
    ...after.nodes
      .filter((node) => !beforeNodes.has(node.id))
      .map((node) => `added box ${node.label} (${node.status})`),
    ...kept
      .filter(({ old, node }) => old.label !== node.label)
      .map(({ old, node }) => `renamed ${old.label} to ${node.label}`),
    ...kept
      .filter(({ old, node }) => old.status !== node.status)
      .map(({ old, node }) => `marked ${node.label} as ${node.status} instead of ${old.status}`),
    ...before.edges.filter((edge) => !afterEdges.has(edgeKey(edge))).map((edge) => `removed arrow ${arrow(edge)}`),
    ...after.edges.filter((edge) => !beforeEdges.has(edgeKey(edge))).map((edge) => `added arrow ${arrow(edge)}`),
    ...keptEdges
      .filter(({ old, edge }) => (old.label ?? '') !== (edge.label ?? ''))
      .map(({ old, edge }) => `relabelled arrow ${arrow(edge)} from ${quoted(old.label)} to ${quoted(edge.label)}`),
  ];
}
