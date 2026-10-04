import { diffGraphs } from '../core/diagram/diff';
import { NODE_H, round1 } from '../core/diagram/layout';
import { STATUS_ORDER } from '../core/diagram/svg';
import type { Graph } from '../core/schema';
import { clearDiagram, loadDiagram, saveDiagram } from './draft';
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
} from './graph-model';
import { SWAPPED_EVENT } from './patch';

export const DIAGRAM_CHANGED_EVENT = 'pinpoint:diagram-changed';

type Selection = { kind: 'node'; id: string } | { kind: 'edge'; from: string; to: string };

type Editor = {
  blockId: string;
  figure: Element;
  root: HTMLElement;
  canvas: HTMLElement;
  snapshot: EditGraph;
  graph: EditGraph;
  selected: Selection | null;
  connectFrom: string | null;
};

const TOOLBAR =
  `<div class="editor-toolbar" role="toolbar" aria-label="Diagram editor">` +
  `<button type="button" data-testid="add-box">Add box</button>` +
  `<button type="button" data-testid="status-selected" disabled>Status</button>` +
  `<button type="button" data-testid="delete-selected" disabled>Delete</button>` +
  `<button type="button" data-testid="reset-diagram">Reset</button>` +
  `<span class="editor-note" data-testid="editor-note" aria-live="polite"></span>` +
  `<button type="button" class="editor-ask" data-action="ask-version" data-testid="ask-version">Ask about my version</button>` +
  `<button type="button" data-testid="done-editing">Done editing</button>` +
  `</div>`;

const SVG_NS = 'http://www.w3.org/2000/svg';
const HANDLE_R = 6;
const STEP_PX = 8;
const BIG_STEP_PX = 32;
const DRAG_THRESHOLD_PX = 3;
const ARROW_STEPS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

let planId = '';
let active: Editor | null = null;

const numberAttr = (el: Element | null, name: string) => Number(el?.getAttribute(name) ?? 0);

function readGraph(svg: Element): EditGraph {
  const nodes = Array.from(svg.querySelectorAll('[data-node-id]'), (el) => {
    const rect = el.querySelector('rect');
    const status = el.getAttribute('data-node-status');
    return {
      id: el.getAttribute('data-node-id') ?? '',
      label: el.getAttribute('data-node-label') ?? '',
      status: STATUS_ORDER.find((s) => s === status) ?? 'reused',
      x: numberAttr(rect, 'x'),
      y: numberAttr(rect, 'y'),
      w: numberAttr(rect, 'width'),
    };
  });
  const edges = Array.from(svg.querySelectorAll('path[data-from]'), (el) => {
    const label = el.getAttribute('data-edge-label');
    return {
      from: el.getAttribute('data-from') ?? '',
      to: el.getAttribute('data-to') ?? '',
      ...(label === null ? {} : { label }),
    };
  });
  return { nodes, edges };
}

function moveNode(g: EditGraph, id: string, x: number, y: number): EditGraph {
  const place = { x: Math.max(0, round1(x)), y: Math.max(0, round1(y)) };
  return { ...g, nodes: g.nodes.map((node) => (node.id === id ? { ...node, ...place } : node)) };
}

const nodeIdOf = (target: EventTarget | null) =>
  target instanceof Element ? (target.closest('[data-node-id]')?.getAttribute('data-node-id') ?? null) : null;

function selectionOf(target: EventTarget | null): Selection | null {
  if (!(target instanceof Element)) return null;
  const id = nodeIdOf(target);
  if (id !== null) return { kind: 'node', id };
  const hit = target.closest('.edge-hit');
  const from = hit?.getAttribute('data-from');
  const to = hit?.getAttribute('data-to');
  return from && to ? { kind: 'edge', from, to } : null;
}

const nodeEl = (editor: Editor, id: string) =>
  editor.canvas.querySelector<SVGGElement>(`[data-node-id="${CSS.escape(id)}"]`);

const edgeEl = (editor: Editor, cls: string, from: string, to: string) =>
  editor.canvas.querySelector<SVGPathElement>(`.${cls}[data-from="${CSS.escape(from)}"][data-to="${CSS.escape(to)}"]`);

const focusTarget = (editor: Editor, sel: Selection) =>
  sel.kind === 'node' ? nodeEl(editor, sel.id) : edgeEl(editor, 'edge-hit', sel.from, sel.to);

const toolbarButton = (editor: Editor, testId: string) =>
  editor.root.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);

const labelOf = (editor: Editor, id: string) => editor.graph.nodes.find((n) => n.id === id)?.label ?? id;

function addHitTargets(editor: Editor): void {
  const withHandles = editor.graph.edges.length < EDGE_LIMIT;
  for (const node of editor.graph.nodes) {
    const g = nodeEl(editor, node.id);
    g?.setAttribute('data-testid', `box-${node.id}`);
    if (!withHandles) continue;
    const handle = document.createElementNS(SVG_NS, 'circle');
    handle.setAttribute('class', 'handle');
    handle.setAttribute('cx', String(round1(node.x + node.w)));
    handle.setAttribute('cy', String(round1(node.y + NODE_H / 2)));
    handle.setAttribute('r', String(HANDLE_R));
    handle.setAttribute('data-handle', node.id);
    handle.setAttribute('data-testid', `handle-${node.id}`);
    g?.append(handle);
  }
  for (const path of Array.from(editor.canvas.querySelectorAll('path.edge'))) {
    const from = path.getAttribute('data-from') ?? '';
    const to = path.getAttribute('data-to') ?? '';
    const hit = document.createElementNS(SVG_NS, 'path');
    hit.setAttribute('class', 'edge-hit');
    hit.setAttribute('d', path.getAttribute('d') ?? '');
    hit.setAttribute('data-from', from);
    hit.setAttribute('data-to', to);
    hit.setAttribute('tabindex', '0');
    hit.setAttribute('aria-label', `Arrow from ${labelOf(editor, from)} to ${labelOf(editor, to)}`);
    hit.setAttribute('data-testid', `arrow-${from}-${to}`);
    path.after(hit);
  }
}

function sync(editor: Editor): void {
  for (const el of Array.from(editor.canvas.querySelectorAll('[data-selected]'))) el.removeAttribute('data-selected');
  const sel = editor.selected;
  const ring =
    sel === null ? null : sel.kind === 'node' ? nodeEl(editor, sel.id) : edgeEl(editor, 'edge', sel.from, sel.to);
  ring?.setAttribute('data-selected', '');
  const add = toolbarButton(editor, 'add-box');
  if (add !== null) {
    add.disabled = editor.graph.nodes.length >= NODE_LIMIT;
    add.title = add.disabled ? `Diagrams hold at most ${NODE_LIMIT} boxes` : '';
  }
  const del = toolbarButton(editor, 'delete-selected');
  if (del !== null) del.disabled = sel === null;
  const status = toolbarButton(editor, 'status-selected');
  if (status !== null) status.disabled = sel?.kind !== 'node';
  const note = editor.root.querySelector('[data-testid="editor-note"]');
  if (note === null) return;
  if (editor.connectFrom !== null) {
    note.textContent = `Connecting from ${labelOf(editor, editor.connectFrom)}: focus a box and press Enter, or Esc to cancel`;
  } else {
    note.textContent = editor.graph.edges.length >= EDGE_LIMIT ? `Diagrams hold at most ${EDGE_LIMIT} arrows` : '';
  }
}

function select(editor: Editor, sel: Selection | null): void {
  editor.selected = sel;
  sync(editor);
}

function render(editor: Editor): void {
  const focused = editor.canvas.contains(document.activeElement) ? selectionOf(document.activeElement) : null;
  editor.canvas.querySelector('svg')?.remove();
  editor.canvas.insertAdjacentHTML('afterbegin', renderEditableSvg(editor.graph, `mk-edit-${editor.blockId}`));
  addHitTargets(editor);
  if (focused !== null) focusTarget(editor, focused)?.focus();
  sync(editor);
}

function commit(editor: Editor, next: EditGraph): void {
  if (next === editor.graph) return;
  editor.graph = next;
  render(editor);
  saveDiagram(planId, editor.blockId, next);
  document.dispatchEvent(new CustomEvent(DIAGRAM_CHANGED_EVENT));
}

function remove(editor: Editor, sel: Selection | null): void {
  if (sel === null) return;
  const next = sel.kind === 'node' ? removeNode(editor.graph, sel.id) : disconnect(editor.graph, sel.from, sel.to);
  if (next === editor.graph) return;
  editor.selected = null;
  commit(editor, next);
  editor.root.focus();
}

function startRename(editor: Editor, id: string): void {
  const rect = nodeEl(editor, id)?.querySelector('rect');
  const node = editor.graph.nodes.find((n) => n.id === id);
  if (rect === undefined || rect === null || node === undefined) return;
  const input = document.createElement('input');
  input.className = 'rename-input';
  input.setAttribute('data-testid', 'rename-input');
  input.setAttribute('aria-label', 'Box name');
  input.maxLength = LABEL_LIMIT;
  input.value = node.label;
  const box = rect.getBoundingClientRect();
  const frame = editor.canvas.getBoundingClientRect();
  input.style.left = `${box.left - frame.left - editor.canvas.clientLeft + editor.canvas.scrollLeft}px`;
  input.style.top = `${box.top - frame.top - editor.canvas.clientTop + editor.canvas.scrollTop}px`;
  input.style.width = `${box.width}px`;
  input.style.height = `${box.height}px`;

  let finished = false;
  const finish = (next: EditGraph | null, refocus: boolean) => {
    if (finished) return;
    finished = true;
    input.remove();
    if (next !== null) commit(editor, next);
    if (refocus) nodeEl(editor, id)?.focus();
  };
  input.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      finish(null, true);
    } else if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault();
      const next = renameNode(editor.graph, id, input.value);
      if (next === editor.graph) input.setAttribute('aria-invalid', 'true');
      else finish(next, true);
    }
  });
  input.addEventListener('input', () => input.removeAttribute('aria-invalid'));
  input.addEventListener('blur', () => {
    const next = renameNode(editor.graph, id, input.value);
    finish(next === editor.graph ? null : next, false);
  });
  editor.canvas.append(input);
  input.select();
}

function setConnectFrom(editor: Editor, id: string | null): void {
  editor.connectFrom = id;
  sync(editor);
}

function startConnect(editor: Editor, event: PointerEvent, from: string): void {
  const svg = editor.canvas.querySelector('svg');
  const handle = event.target instanceof Element ? event.target.closest('[data-handle]') : null;
  if (svg === null || handle === null) return;
  event.preventDefault();
  const line = document.createElementNS(SVG_NS, 'line');
  line.setAttribute('class', 'connect-preview');
  line.setAttribute('x1', handle.getAttribute('cx') ?? '0');
  line.setAttribute('y1', handle.getAttribute('cy') ?? '0');
  const follow = (e: PointerEvent) => {
    const frame = svg.getBoundingClientRect();
    line.setAttribute('x2', String(round1(e.clientX - frame.left)));
    line.setAttribute('y2', String(round1(e.clientY - frame.top)));
  };
  follow(event);
  svg.append(line);
  const finish = (e: PointerEvent) => {
    document.removeEventListener('pointermove', follow);
    document.removeEventListener('pointerup', finish);
    document.removeEventListener('pointercancel', finish);
    line.remove();
    const to = e.type === 'pointerup' ? nodeIdOf(document.elementFromPoint(e.clientX, e.clientY)) : null;
    if (to !== null) commit(editor, connect(editor.graph, from, to));
  };
  document.addEventListener('pointermove', follow);
  document.addEventListener('pointerup', finish);
  document.addEventListener('pointercancel', finish);
}

function startDrag(editor: Editor, event: PointerEvent): void {
  const node = editor.graph.nodes.find((n) => n.id === nodeIdOf(event.target));
  if (event.button !== 0 || node === undefined) return;
  let moved = false;
  const move = (e: PointerEvent) => {
    const dx = e.clientX - event.clientX;
    const dy = e.clientY - event.clientY;
    if (!moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    moved = true;
    commit(editor, moveNode(editor.graph, node.id, node.x + dx, node.y + dy));
  };
  const end = () => {
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', end);
    document.removeEventListener('pointercancel', end);
  };
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', end);
  document.addEventListener('pointercancel', end);
}

function onKey(editor: Editor, event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    if (editor.connectFrom === null) close(true);
    else setConnectFrom(editor, null);
    return;
  }
  const target = selectionOf(event.target);
  if (target === null || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault();
    remove(editor, target);
    return;
  }
  const node = target.kind === 'node' ? editor.graph.nodes.find((n) => n.id === target.id) : undefined;
  if (node === undefined) return;
  if (event.key === 'Enter' && editor.connectFrom !== null) {
    event.preventDefault();
    commit(editor, connect(editor.graph, editor.connectFrom, node.id));
    setConnectFrom(editor, null);
    return;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    startRename(editor, node.id);
    return;
  }
  if (event.key.toLowerCase() === 's') {
    event.preventDefault();
    commit(editor, cycleStatus(editor.graph, node.id));
    return;
  }
  if (event.key.toLowerCase() === 'c' && editor.graph.edges.length < EDGE_LIMIT) {
    event.preventDefault();
    setConnectFrom(editor, node.id);
    return;
  }
  const arrow = ARROW_STEPS[event.key];
  if (arrow === undefined) return;
  event.preventDefault();
  const step = event.shiftKey ? BIG_STEP_PX : STEP_PX;
  commit(editor, moveNode(editor.graph, node.id, node.x + arrow[0] * step, node.y + arrow[1] * step));
}

function close(restoreFocus: boolean): void {
  if (active === null) return;
  const { root, figure } = active;
  active = null;
  root.replaceWith(figure);
  document.dispatchEvent(new CustomEvent(DIAGRAM_CHANGED_EVENT));
  if (restoreFocus) figure.querySelector<HTMLElement>('[data-action="edit-diagram"]')?.focus();
}

function open(figure: Element, kept?: EditGraph): void {
  const blockId = figure.closest<HTMLElement>('[data-block]')?.dataset.block;
  const svg = figure.querySelector('svg');
  if (blockId === undefined || svg === null) return;
  close(false);

  const root = document.createElement('div');
  root.className = 'diagram-editor';
  // A data-action ancestor keeps clicks in the editor from selecting the block.
  root.dataset.action = 'edit-canvas';
  root.tabIndex = -1;
  root.setAttribute('data-testid', `editor-${blockId}`);
  root.innerHTML = `${TOOLBAR}<div class="editor-canvas" role="group" aria-label="Editable diagram"></div>`;
  const canvas = root.querySelector<HTMLElement>('.editor-canvas');
  if (canvas === null) return;

  const snapshot = readGraph(svg);
  const graph = kept ?? loadDiagram(planId, blockId) ?? snapshot;
  const editor: Editor = { blockId, figure, root, canvas, snapshot, graph, selected: null, connectFrom: null };
  active = editor;
  render(editor);
  figure.replaceWith(root);

  const onClick = (testId: string, handler: () => void) =>
    toolbarButton(editor, testId)?.addEventListener('click', handler);
  onClick('done-editing', () => close(true));
  onClick('delete-selected', () => remove(editor, editor.selected));
  onClick('reset-diagram', () => {
    editor.selected = null;
    editor.connectFrom = null;
    commit(editor, editor.snapshot);
    clearDiagram(planId, blockId);
    sync(editor);
  });
  onClick('status-selected', () => {
    if (editor.selected?.kind === 'node') commit(editor, cycleStatus(editor.graph, editor.selected.id));
  });
  onClick('add-box', () => {
    const next = addNode(editor.graph, 'New box');
    const added = next.nodes.at(-1);
    if (next === editor.graph || added === undefined) return;
    commit(editor, next);
    startRename(editor, added.id);
  });
  root.addEventListener('keydown', (event) => onKey(editor, event));
  root.addEventListener('focusin', (event) => {
    const sel = selectionOf(event.target);
    if (sel !== null) select(editor, sel);
  });
  canvas.addEventListener('pointerdown', (event) => {
    if (event.target === canvas || event.target instanceof SVGSVGElement) select(editor, null);
    const from =
      event.target instanceof Element ? event.target.closest('[data-handle]')?.getAttribute('data-handle') : null;
    if (from) startConnect(editor, event, from);
    else startDrag(editor, event);
  });
  canvas.addEventListener('dblclick', (event) => {
    const id = nodeIdOf(event.target);
    if (id !== null) startRename(editor, id);
  });
  // A reopen after a live swap takes focus only when the swap dropped it, so a composer keeps its caret.
  if (kept === undefined || document.activeElement === document.body) root.focus();
}

/** The edited graph of the block being edited, without positions, or null when it says the same as the agent's. */
export function editedProposal(blockId: string): { proposal: Graph; changes: number } | null {
  if (active === null || active.blockId !== blockId) return null;
  const proposal = {
    nodes: active.graph.nodes.map(({ id, label, status }) => ({ id, label, status })),
    edges: active.graph.edges,
  };
  const changes = diffGraphs(active.snapshot, proposal).length;
  return changes === 0 ? null : { proposal, changes };
}

export function finishProposal(blockId: string): void {
  clearDiagram(planId, blockId);
  if (active?.blockId === blockId) close(false);
}

export function initDiagramEditor(forPlan: string): void {
  planId = forPlan;
  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    const figure = event.target.closest('[data-action="edit-diagram"]')?.closest('figure.diagram');
    if (figure) open(figure);
  });

  document.addEventListener(SWAPPED_EVENT, (event) => {
    const { blockId } = (event as CustomEvent<{ blockId: string }>).detail;
    if (active === null || active.blockId !== blockId || active.root.isConnected) return;
    const figure = document.querySelector(`[data-block="${CSS.escape(blockId)}"] figure.diagram`);
    if (figure !== null) open(figure, active.graph);
  });
}
