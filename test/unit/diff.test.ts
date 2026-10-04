import { describe, expect, it } from 'bun:test';
import { diffGraphs } from '../../src/core/diagram/diff';
import type { Graph } from '../../src/core/schema';

const before: Graph = {
  nodes: [
    { id: 'caller', label: 'Call site', status: 'external' },
    { id: 'wrapper', label: 'Fetch wrapper', status: 'reused' },
    { id: 'retry', label: 'Retry helper', status: 'reused' },
    { id: 'old', label: 'Old queue', status: 'changed' },
  ],
  edges: [
    { from: 'caller', to: 'wrapper' },
    { from: 'wrapper', to: 'retry', label: 'on 401' },
    { from: 'wrapper', to: 'old' },
    { from: 'retry', to: 'caller', label: 'done' },
  ],
};

const after: Graph = {
  nodes: [
    { id: 'caller', label: 'Call site', status: 'external' },
    { id: 'wrapper', label: 'Fetch wrapper', status: 'changed' },
    { id: 'retry', label: 'Backoff', status: 'new' },
    { id: 'cache', label: 'Cache', status: 'new' },
  ],
  edges: [
    { from: 'caller', to: 'wrapper', label: 'calls' },
    { from: 'wrapper', to: 'retry', label: 'on 503' },
    { from: 'wrapper', to: 'cache' },
    { from: 'retry', to: 'caller' },
  ],
};

describe('diffGraphs', () => {
  it('diffGraphs names every added, removed, renamed and restatused box and arrow', () => {
    expect(diffGraphs(before, after)).toEqual([
      'removed box Old queue',
      'added box Cache (new)',
      'renamed Retry helper to Backoff',
      'marked Fetch wrapper as changed instead of reused',
      'marked Backoff as new instead of reused',
      'removed arrow Fetch wrapper → Old queue',
      'added arrow Fetch wrapper → Cache',
      'relabelled arrow Call site → Fetch wrapper from no label to "calls"',
      'relabelled arrow Fetch wrapper → Backoff from "on 401" to "on 503"',
      'relabelled arrow Backoff → Call site from "done" to no label',
    ]);
  });

  it('identical graphs have no differences', () => {
    const reordered: Graph = { nodes: [...before.nodes].reverse(), edges: [...before.edges].reverse() };

    expect(diffGraphs(before, structuredClone(before))).toEqual([]);
    expect(diffGraphs(before, reordered)).toEqual([]);
  });
});
