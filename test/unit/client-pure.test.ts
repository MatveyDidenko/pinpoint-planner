import { describe, expect, it } from 'bun:test';
import { composerKeyAction } from '../../src/client/composer';
import { draftKey } from '../../src/client/draft';
import { EXCERPT_LIMIT, excerptFrom } from '../../src/client/excerpt';
import {
  addNode,
  connect,
  cycleStatus,
  disconnect,
  EDGE_LIMIT,
  type EditGraph,
  LABEL_LIMIT,
  NODE_LIMIT,
  removeNode,
  renameNode,
  renderEditableSvg,
} from '../../src/client/graph-model';
import { parseFrame } from '../../src/client/live';
import { backPath, forwardPath, GAP_Y, measureLabel, NODE_H, PAD } from '../../src/core/diagram/layout';
import { EXCERPT_MAX, GraphSchema, MAX_EDGES, MAX_NODES } from '../../src/core/schema';

describe('parseFrame', () => {
  it('parseFrame decodes a known event with a JSON object payload', () => {
    const data = { blockId: 'opt-b', rev: 2, html: '<section></section>', revision: 5 };

    expect(parseFrame('block', JSON.stringify(data))).toEqual({ event: 'block', data });
  });

  it('parseFrame rejects an unknown event name', () => {
    expect(parseFrame('teleport', '{"revision":1}')).toBeNull();
  });

  it('parseFrame rejects a payload that is not a JSON object', () => {
    expect(parseFrame('plan', '{not json')).toBeNull();
    expect(parseFrame('plan', '7')).toBeNull();
    expect(parseFrame('plan', 'null')).toBeNull();
  });
});

describe('composerKeyAction', () => {
  const key = (name: string, shiftKey = false, isComposing = false) => ({ key: name, shiftKey, isComposing });

  it('composerKeyAction table', () => {
    const rows: [ReturnType<typeof key>, boolean, ReturnType<typeof composerKeyAction>][] = [
      [key('Enter'), false, 'send'],
      [key('Enter', true), false, 'newline'],
      [key('Escape'), true, 'close'],
      [key('Escape'), false, 'none'],
      [key('Enter', false, true), false, 'none'],
      [key('Escape', false, true), true, 'none'],
      [key('a'), true, 'none'],
    ];

    for (const [event, textEmpty, expected] of rows) {
      expect(composerKeyAction(event, textEmpty)).toBe(expected);
    }
  });
});

describe('excerptFrom', () => {
  it('excerptFrom trims and caps at 200 chars', () => {
    const long = 'a'.repeat(EXCERPT_MAX + 50);
    const rows: [string | null, string | null, number, string | undefined][] = [
      ['  hello  world \n', null, EXCERPT_MAX, 'hello world'],
      ['line one\n\nline two', null, EXCERPT_MAX, 'line one line two'],
      ['picked text', 'Fetch wrapper', EXCERPT_MAX, 'picked text'],
      ['   ', ' Fetch   wrapper ', EXCERPT_MAX, 'Fetch wrapper'],
      [null, 'Refresh timer', EXCERPT_MAX, 'Refresh timer'],
      [null, null, EXCERPT_MAX, undefined],
      ['  ', '', EXCERPT_MAX, undefined],
      [long, null, EXCERPT_MAX, 'a'.repeat(EXCERPT_MAX)],
      ['ab cd', null, 3, 'ab'],
    ];

    for (const [selection, label, max, expected] of rows) {
      expect(excerptFrom(selection, label, max)).toBe(expected);
    }
  });

  it('the client excerpt limit matches the schema limit', () => {
    expect(EXCERPT_LIMIT).toBe(EXCERPT_MAX);
  });
});

describe('draftKey', () => {
  it('draftKey is stable and namespaced', () => {
    expect(draftKey('plan-1', 'opt-c')).toBe(draftKey('plan-1', 'opt-c'));
    expect(draftKey('plan-1', 'opt-c')).toStartWith('pinpoint:draft:');
    expect(draftKey('plan-1', 'opt-c')).not.toBe(draftKey('plan-1', 'opt-a'));
    expect(draftKey('plan-1', 'opt-c')).not.toBe(draftKey('plan-2', 'opt-c'));
    expect(draftKey('a:b', 'c')).not.toBe(draftKey('a', 'b:c'));
  });
});

type EditNode = EditGraph['nodes'][number];

const box = (id: string, x: number, y: number, label = id): EditNode => ({
  id,
  label,
  status: 'reused',
  x,
  y,
  w: measureLabel(label),
});

const overlaps = (a: EditNode, b: EditNode): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + NODE_H && b.y < a.y + NODE_H;

const editGraph: EditGraph = {
  nodes: [box('n1', 24, 24, 'Client'), box('api', 156, 24, 'Token API'), box('store', 156, 76, 'Session store')],
  edges: [
    { from: 'n1', to: 'api', label: 'refresh' },
    { from: 'api', to: 'store' },
  ],
};

describe('addNode', () => {
  it('addNode places a new box below the others without overlap', () => {
    const next = addNode(editGraph, 'Cache');
    const added = next.nodes.at(-1);

    expect(next.nodes).toHaveLength(4);
    expect(added).toEqual({
      id: 'n2',
      label: 'Cache',
      status: 'new',
      x: PAD,
      y: 76 + NODE_H + GAP_Y,
      w: measureLabel('Cache'),
    });
    for (const other of editGraph.nodes) expect(added && overlaps(added, other)).toBe(false);
    expect(next.edges).toEqual(editGraph.edges);
    expect(editGraph.nodes).toHaveLength(3);
  });

  it('addNode at eight boxes returns the graph unchanged', () => {
    const full: EditGraph = {
      nodes: Array.from({ length: MAX_NODES }, (_, i) => box(`b${i}`, PAD, PAD + i * (NODE_H + GAP_Y))),
      edges: [],
    };

    expect(addNode(full, 'Ninth')).toBe(full);
  });

  it('the client node limit matches the schema limit', () => {
    expect(NODE_LIMIT).toBe(MAX_NODES);
  });
});

describe('removeNode', () => {
  it('removeNode drops the box and every arrow touching it', () => {
    const withoutApi = removeNode(editGraph, 'api');
    const withoutStore = removeNode(editGraph, 'store');

    expect(withoutApi.nodes.map((n) => n.id)).toEqual(['n1', 'store']);
    expect(withoutApi.edges).toEqual([]);
    expect(withoutStore.nodes.map((n) => n.id)).toEqual(['n1', 'api']);
    expect(withoutStore.edges).toEqual([{ from: 'n1', to: 'api', label: 'refresh' }]);
    expect(editGraph.nodes).toHaveLength(3);
    expect(editGraph.edges).toHaveLength(2);
  });

  it('removeNode with an unknown id returns the graph unchanged', () => {
    expect(removeNode(editGraph, 'ghost')).toBe(editGraph);
  });

  it('removeNode refuses to remove the last box', () => {
    const single: EditGraph = { nodes: [box('only', PAD, PAD)], edges: [] };

    expect(removeNode(single, 'only')).toBe(single);
    expect(single.nodes).toHaveLength(1);
  });
});

describe('connect', () => {
  it('connect adds one arrow and disconnect removes it', () => {
    const connected = connect(editGraph, 'store', 'n1');

    expect(connected.edges).toEqual([...editGraph.edges, { from: 'store', to: 'n1' }]);
    expect(editGraph.edges).toHaveLength(2);
    expect(disconnect(connected, 'store', 'n1').edges).toEqual(editGraph.edges);
    expect(disconnect(editGraph, 'store', 'n1')).toBe(editGraph);
  });

  it('connect refuses a self arrow, a duplicate and a thirteenth arrow', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const pairs = ids.flatMap((from) => ids.filter((to) => to !== from).map((to) => ({ from, to })));
    const full: EditGraph = {
      nodes: ids.map((id, i) => box(id, PAD, PAD + i * (NODE_H + GAP_Y))),
      edges: pairs.slice(0, MAX_EDGES),
    };
    const thirteenth = pairs[MAX_EDGES];

    expect(connect(editGraph, 'api', 'api')).toBe(editGraph);
    expect(connect(editGraph, 'n1', 'api')).toBe(editGraph);
    expect(thirteenth && connect(full, thirteenth.from, thirteenth.to)).toBe(full);
  });

  it('the client edge limit matches the schema limit', () => {
    expect(EDGE_LIMIT).toBe(MAX_EDGES);
  });
});

describe('renameNode', () => {
  it('renameNode trims the label and resizes the box', () => {
    const renamed = renameNode(editGraph, 'api', '  Auth gateway service ');
    const longest = renameNode(editGraph, 'api', 'x'.repeat(LABEL_LIMIT));

    expect(renamed.nodes[1]).toEqual(box('api', 156, 24, 'Auth gateway service'));
    expect(renamed.nodes[1]?.w).toBeGreaterThan(measureLabel('Token API'));
    expect(renamed.nodes[0]).toBe(editGraph.nodes[0]);
    expect(longest.nodes[1]?.label).toHaveLength(LABEL_LIMIT);
    expect(editGraph.nodes[1]?.label).toBe('Token API');
  });

  it('renameNode with an empty or 41-char label returns the graph unchanged', () => {
    expect(renameNode(editGraph, 'api', '')).toBe(editGraph);
    expect(renameNode(editGraph, 'api', '   ')).toBe(editGraph);
    expect(renameNode(editGraph, 'api', 'x'.repeat(LABEL_LIMIT + 1))).toBe(editGraph);
    expect(renameNode(editGraph, 'ghost', 'Fine')).toBe(editGraph);
  });

  it('the client label limit matches the schema limit', () => {
    const parses = (label: string) =>
      GraphSchema.safeParse({ nodes: [{ id: 'a', label, status: 'new' }], edges: [] }).success;

    expect(parses('x'.repeat(LABEL_LIMIT))).toBe(true);
    expect(parses('x'.repeat(LABEL_LIMIT + 1))).toBe(false);
  });
});

describe('cycleStatus', () => {
  it('cycleStatus steps through all four statuses and wraps', () => {
    const once = cycleStatus(editGraph, 'api');
    const twice = cycleStatus(once, 'api');
    const thrice = cycleStatus(twice, 'api');
    const wrapped = cycleStatus(thrice, 'api');

    expect([once, twice, thrice, wrapped].map((g) => g.nodes[1]?.status)).toEqual([
      'new',
      'changed',
      'external',
      'reused',
    ]);
    expect(once.nodes[0]).toBe(editGraph.nodes[0]);
    expect(editGraph.nodes[1]?.status).toBe('reused');
  });

  it('cycleStatus with an unknown id returns the graph unchanged', () => {
    expect(cycleStatus(editGraph, 'ghost')).toBe(editGraph);
  });

  it('the status cycle follows the schema status order', () => {
    const order = GraphSchema.shape.nodes.element.shape.status.options;

    order.forEach((status, i) => {
      const single: EditGraph = { nodes: [{ ...box('a', PAD, PAD), status }], edges: [] };
      expect(cycleStatus(single, 'a').nodes[0]?.status).toBe(order[(i + 1) % order.length]);
    });
  });
});

describe('renderEditableSvg', () => {
  const count = (haystack: string, needle: RegExp): number => haystack.match(needle)?.length ?? 0;

  it('renderEditableSvg puts each box at its stored position', () => {
    const svg = renderEditableSvg(editGraph, 'edit-arrow');
    const hostile = renderEditableSvg(renameNode(editGraph, 'n1', '<b>"x"&'), 'edit-arrow');

    expect(svg).toStartWith('<svg');
    expect(svg).toContain('viewBox="0 0 291.6 134" width="291.6" height="134"');
    expect(count(svg, /<marker id="edit-arrow"/g)).toBe(1);
    for (const node of editGraph.nodes) {
      expect(svg).toContain(`<rect x="${node.x}" y="${node.y}" width="${node.w}" height="${NODE_H}" rx="8"`);
    }
    expect(svg).toContain(
      '<g class="node node--reused" data-node-id="api" data-node-label="Token API" data-node-status="reused" tabindex="0">',
    );
    expect(svg).toContain('<title>Session store</title>');
    expect(count(svg, /tabindex="0"/g)).toBe(3);
    expect(svg).toContain(
      `<path class="edge" data-from="n1" data-to="api" data-edge-label="refresh" d="${forwardPath(96, 41, 156, 41)}" marker-end="url(#edit-arrow)"/>`,
    );
    expect(svg).toContain('<text class="edge-label"');
    expect(svg).toContain('>refresh</text>');
    expect(count(svg, /<path class="edge/g)).toBe(2);
    expect(hostile).not.toContain('<b>');
    expect(hostile).toContain('data-node-label="&lt;b&gt;&quot;x&quot;&amp;"');
  });

  it('an arrow to a box on the left is drawn as a back arc', () => {
    const left = box('left', 24, 64, 'Left');
    const right = box('right', 200, 64, 'Right');
    const svg = renderEditableSvg(
      {
        nodes: [left, right],
        edges: [
          { from: 'right', to: 'left' },
          { from: 'left', to: 'right' },
        ],
      },
      'm',
    );

    expect(svg).toContain(
      `<path class="edge edge--back" data-from="right" data-to="left" d="${backPath(200 + right.w / 2, 64, 24 + left.w / 2, 64)}"`,
    );
    expect(svg).toContain(
      `<path class="edge" data-from="left" data-to="right" d="${forwardPath(24 + left.w, 81, 200, 81)}"`,
    );
  });
});
