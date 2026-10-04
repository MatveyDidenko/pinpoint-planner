import { describe, expect, it } from 'bun:test';
import { renderGraphSvg, renderLegend } from '../../src/core/diagram/svg';
import type { Graph } from '../../src/core/schema';

const graph: Graph = {
  nodes: [
    { id: 'client', label: 'Client', status: 'reused' },
    { id: 'api', label: 'Token API', status: 'new' },
    { id: 'store', label: 'Session store', status: 'changed' },
    { id: 'idp', label: 'IdP', status: 'external' },
  ],
  edges: [
    { from: 'client', to: 'api', label: 'refresh' },
    { from: 'api', to: 'store' },
    { from: 'store', to: 'client' },
    { from: 'api', to: 'idp' },
  ],
};

const opts = { markerId: 'arrow-a', ariaLabel: 'Refresh flow' };

function count(haystack: string, needle: RegExp): number {
  return haystack.match(needle)?.length ?? 0;
}

describe('renderGraphSvg', () => {
  it('renders one node group per node and one edge path per edge with data-node attributes', () => {
    const svg = renderGraphSvg(graph, opts);

    expect(svg).toStartWith('<svg');
    expect(svg).toContain('role="img"');
    expect(svg).toContain('aria-label="Refresh flow"');
    expect(svg).toMatch(/viewBox="0 0 [\d.]+ [\d.]+"/);
    expect(count(svg, /<g class="node node--/g)).toBe(4);
    expect(svg).toContain(
      '<g class="node node--reused" data-node-id="client" data-node-label="Client" data-node-status="reused">',
    );
    expect(svg).toContain(
      '<g class="node node--new" data-node-id="api" data-node-label="Token API" data-node-status="new">',
    );
    expect(svg).toContain('<g class="node node--changed" data-node-id="store"');
    expect(svg).toContain('<g class="node node--external" data-node-id="idp"');
    expect(svg).toContain('<title>Session store</title>');
    expect(svg).toContain('var(--diagram-new)');
    expect(count(svg, /<rect /g)).toBe(4);
    expect(count(svg, /<path class="edge(?: edge--back)?"/g)).toBe(4);
    expect(count(svg, /<path class="edge edge--back"/g)).toBe(1);
    expect(svg).toContain('>refresh</text>');
  });

  it('labels are escaped and two renders are byte-identical', () => {
    const hostile: Graph = {
      nodes: [
        { id: 'a', label: '<b>"x"&\'y\'', status: 'new' },
        { id: 'b', label: 'B', status: 'reused' },
      ],
      edges: [{ from: 'a', to: 'b', label: '<i>&' }],
    };
    const first = renderGraphSvg(hostile, { markerId: 'm"1', ariaLabel: '<script>' });

    expect(first).not.toContain('<b>');
    expect(first).not.toContain('<i>');
    expect(first).not.toContain('<script>');
    expect(first).toContain('data-node-label="&lt;b&gt;&quot;x&quot;&amp;&#39;y&#39;"');
    expect(first).toContain('<title>&lt;b&gt;&quot;x&quot;&amp;&#39;y&#39;</title>');
    expect(first).toContain('aria-label="&lt;script&gt;"');
    expect(first).toContain('&lt;i&gt;&amp;');
    expect(first).toContain('id="m&quot;1"');
    expect(renderGraphSvg(hostile, { markerId: 'm"1', ariaLabel: '<script>' })).toBe(first);
    expect(renderGraphSvg(graph, opts)).toBe(renderGraphSvg(graph, opts));
  });

  it('node and edge elements carry enough attributes to rebuild the graph', () => {
    const svg = renderGraphSvg(graph, opts);
    const nodes = [
      ...svg.matchAll(/<g [^>]*data-node-id="([^"]*)" data-node-label="([^"]*)" data-node-status="([^"]*)"/g),
    ].map(([, id, label, status]) => ({ id, label, status }));
    const edges = [
      ...svg.matchAll(/<path class="edge[^"]*" data-from="([^"]*)" data-to="([^"]*)"(?: data-edge-label="([^"]*)")?/g),
    ].map(([, from, to, label]) => (label === undefined ? { from, to } : { from, to, label }));

    expect(nodes).toHaveLength(graph.nodes.length);
    expect(nodes).toEqual(expect.arrayContaining(graph.nodes));
    expect(edges).toEqual(graph.edges);
  });

  it('an unlabelled edge has no data-edge-label', () => {
    const svg = renderGraphSvg(
      {
        nodes: [
          { id: 'a', label: 'A', status: 'new' },
          { id: 'b', label: 'B', status: 'reused' },
        ],
        edges: [{ from: 'a', to: 'b' }],
      },
      opts,
    );

    expect(svg).toContain('<path class="edge" data-from="a" data-to="b" d="');
    expect(svg).not.toContain('data-edge-label');
  });

  it('marker ids come from opts so two diagrams in one block cannot collide', () => {
    const one = renderGraphSvg(graph, { markerId: 'arrow-one', ariaLabel: 'one' });
    const two = renderGraphSvg(graph, { markerId: 'arrow-two', ariaLabel: 'two' });

    expect(count(one, /<marker id="arrow-one"/g)).toBe(1);
    expect(count(one, /marker-end="url\(#arrow-one\)"/g)).toBe(4);
    expect(one).not.toContain('arrow-two');
    expect(count(two, /<marker id="arrow-two"/g)).toBe(1);
    expect(count(two, /marker-end="url\(#arrow-two\)"/g)).toBe(4);
    expect(two).not.toContain('arrow-one');
  });
});

describe('renderLegend', () => {
  it('lists only present statuses once each in canonical order', () => {
    const html = renderLegend(['external', 'new', 'external', 'reused']);

    expect(html).toStartWith('<ul class="legend"');
    expect(count(html, /<li /g)).toBe(3);
    expect(html.indexOf('data-status="reused"')).toBeLessThan(html.indexOf('data-status="new"'));
    expect(html.indexOf('data-status="new"')).toBeLessThan(html.indexOf('data-status="external"'));
    expect(html).toContain('Reused');
    expect(html).not.toContain('data-status="changed"');
  });
});
