import { type APIRequestContext, expect, type Locator, type Page, test } from '@playwright/test';
import { seedPlan } from './support';

async function openPlan(page: Page, request: APIRequestContext, name: string): Promise<string> {
  const id = `edit-${name}-${Date.now()}`;
  await seedPlan(request, id);
  await page.goto(`/plans/${id}`);
  return id;
}

function boxes(root: Locator) {
  return root.locator('[data-node-id]').evaluateAll((els) =>
    els.map((el) => {
      const rect = el.querySelector('rect');
      return {
        id: el.getAttribute('data-node-id'),
        label: el.getAttribute('data-node-label'),
        status: el.getAttribute('data-node-status'),
        x: rect?.getAttribute('x'),
        y: rect?.getAttribute('y'),
        w: rect?.getAttribute('width'),
      };
    }),
  );
}

test('Edit diagram opens the editor with the same boxes and Done editing restores the figure', async ({
  page,
  request,
}) => {
  await openPlan(page, request, 'open');
  const figure = page.getByTestId('block-opt-a').locator('figure.diagram');
  const before = await boxes(figure);

  await expect(page.getByTestId('edit-opt-a')).toBeVisible();
  await page.getByTestId('edit-opt-a').click();
  const editor = page.getByTestId('editor-opt-a');
  await expect(editor).toBeVisible();
  await expect(figure).toHaveCount(0);
  expect(await boxes(editor)).toEqual(before);
  await expect(editor.locator('path.edge')).toHaveCount(4);

  await page.getByTestId('done-editing').click();
  await expect(editor).toHaveCount(0);
  expect(await boxes(figure)).toEqual(before);
  await expect(page.getByTestId('edit-opt-a')).toBeFocused();

  await page.getByTestId('edit-opt-a').click();
  await expect(editor).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(editor).toHaveCount(0);
  await expect(figure.locator('svg')).toBeVisible();
});

test('clicking Edit diagram does not open the composer', async ({ page, request }) => {
  await openPlan(page, request, 'no-composer');

  await expect(page.getByTestId('edit-opt-a')).toBeVisible();
  await page.getByTestId('edit-opt-a').click();
  const editor = page.getByTestId('editor-opt-a');
  await expect(editor).toBeVisible();
  await editor.locator('[data-node-id="api"]').click();
  await page.keyboard.press('Enter');

  await expect(page.getByTestId('composer')).toBeHidden();
  await expect(page.getByTestId('block-opt-a')).not.toHaveAttribute('data-selected');
});

async function openEditor(page: Page, request: APIRequestContext, name: string, block = 'opt-a'): Promise<Locator> {
  await openPlan(page, request, name);
  await page.getByTestId(`edit-${block}`).click();
  const editor = page.getByTestId(`editor-${block}`);
  await expect(editor).toBeVisible();
  return editor;
}

async function centre(locator: Locator): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error('element has no box');
  return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
}

test('dragging a box moves it and its arrows follow', async ({ page, request }) => {
  const editor = await openEditor(page, request, 'drag');
  const rect = editor.locator('[data-node-id="api"] rect');
  await expect(rect).toHaveAttribute('x', '334');
  await expect(rect).toHaveAttribute('y', '76');

  const start = await centre(rect);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 80, start.y + 40, { steps: 5 });
  await page.mouse.up();

  await expect(rect).toHaveAttribute('x', '414');
  await expect(rect).toHaveAttribute('y', '116');
  await expect(editor.locator('path.edge[data-from="wrapper"][data-to="api"]')).toHaveAttribute('d', / 414 133$/);
});

test('arrow keys move the focused box and it cannot leave the canvas', async ({ page, request }) => {
  const editor = await openEditor(page, request, 'keys');
  const caller = editor.locator('[data-node-id="caller"]');
  const rect = caller.locator('rect');
  await caller.focus();

  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  await expect(rect).toHaveAttribute('x', '32');
  await expect(rect).toHaveAttribute('y', '56');
  await expect(caller).toBeFocused();

  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Shift+ArrowUp');
  await page.keyboard.press('Shift+ArrowUp');
  await expect(rect).toHaveAttribute('x', '0');
  await expect(rect).toHaveAttribute('y', '0');
  await expect(editor.locator('path.edge[data-from="caller"][data-to="wrapper"]')).toHaveAttribute('d', /^M82\.8 17C/);
});

test('double-click renames a box and the box widens to fit', async ({ page, request }) => {
  const editor = await openEditor(page, request, 'rename');
  const api = editor.locator('[data-node-id="api"]');
  await expect(api.locator('rect')).toHaveAttribute('width', '72');

  await api.dblclick();
  const input = page.getByTestId('rename-input');
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('API');
  await input.fill('Upstream billing API');
  await input.press('Enter');

  await expect(input).toHaveCount(0);
  await expect(api).toHaveAttribute('data-node-label', 'Upstream billing API');
  await expect(api.locator('rect')).toHaveAttribute('width', '162');
  await expect(api).toBeFocused();
});

test('Esc cancels a rename and an empty name is refused', async ({ page, request }) => {
  const editor = await openEditor(page, request, 'rename-cancel');
  const box = editor.locator('[data-node-id="refresh"]');
  const input = page.getByTestId('rename-input');
  await box.focus();

  await page.keyboard.press('Enter');
  await expect(input).toHaveValue('Refresh call');
  await input.fill('Something else');
  await input.press('Escape');
  await expect(input).toHaveCount(0);
  await expect(editor).toBeVisible();
  await expect(box).toHaveAttribute('data-node-label', 'Refresh call');
  await expect(box).toBeFocused();

  await page.keyboard.press('Enter');
  await input.fill('   ');
  await input.press('Enter');
  await expect(input).toBeVisible();
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await expect(box).toHaveAttribute('data-node-label', 'Refresh call');
});

test('Add box adds a box ready to rename', async ({ page, request }) => {
  const editor = await openEditor(page, request, 'add');
  const add = page.getByTestId('add-box');
  await expect(add).toBeEnabled();
  await expect(editor.locator('[data-node-id]')).toHaveCount(5);

  await add.click();
  await expect(editor.locator('[data-node-id]')).toHaveCount(6);
  const added = editor.locator('[data-node-id="n1"]');
  await expect(added).toHaveAttribute('data-node-label', 'New box');
  await expect(added).toHaveAttribute('data-node-status', 'new');
  const input = page.getByTestId('rename-input');
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('New box');

  await input.fill('Token cache');
  await input.press('Enter');
  await expect(added).toHaveAttribute('data-node-label', 'Token cache');
});

test('Add box is disabled at eight boxes', async ({ page, request }) => {
  const editor = await openEditor(page, request, 'add-full');
  const add = page.getByTestId('add-box');
  await expect(add).toBeEnabled();

  for (let i = 0; i < 3; i++) {
    await add.click();
    await page.getByTestId('rename-input').press('Enter');
  }
  await expect(editor.locator('[data-node-id]')).toHaveCount(8);
  await expect(add).toBeDisabled();
  await expect(add).toHaveAttribute('title', 'Diagrams hold at most 8 boxes');
  await add.click({ force: true });
  await expect(editor.locator('[data-node-id]')).toHaveCount(8);
});

test('Delete removes the selected box and its arrows', async ({ page, request }) => {
  const editor = await openEditor(page, request, 'delete');
  const wrapper = editor.locator('[data-node-id="wrapper"]');
  const del = page.getByTestId('delete-selected');
  await expect(del).toBeDisabled();

  await wrapper.click();
  await expect(wrapper).toHaveAttribute('data-selected', '');
  await expect(del).toBeEnabled();
  await del.click();
  await expect(wrapper).toHaveCount(0);
  await expect(editor.locator('[data-node-id]')).toHaveCount(4);
  await expect(editor.locator('path.edge')).toHaveCount(1);
  await expect(del).toBeDisabled();

  const session = editor.locator('[data-node-id="session"]');
  await session.focus();
  await page.keyboard.press('Backspace');
  await expect(session).toHaveCount(0);
  await expect(editor.locator('path.edge')).toHaveCount(0);
  await expect(editor).toBeVisible();
});

test('Delete on a selected arrow removes only that arrow', async ({ page, request }) => {
  const editor = await openEditor(page, request, 'delete-arrow');
  const arrow = page.getByTestId('arrow-wrapper-api');
  const edge = editor.locator('path.edge[data-from="wrapper"][data-to="api"]');
  await expect(arrow).toBeVisible();

  await arrow.click();
  await expect(edge).toHaveAttribute('data-selected', '');
  await page.keyboard.press('Delete');
  await expect(edge).toHaveCount(0);
  await expect(editor.locator('path.edge')).toHaveCount(3);
  await expect(editor.locator('[data-node-id]')).toHaveCount(5);
});

async function dragBetween(page: Page, from: Locator, to: Locator): Promise<void> {
  const start = await centre(from);
  const end = await centre(to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await page.mouse.up();
}

test('dragging from a handle to another box adds an arrow', async ({ page, request }) => {
  const editor = await openEditor(page, request, 'connect');
  const handle = page.getByTestId('handle-caller');
  await expect(handle).toBeVisible();
  await expect(editor.locator('path.edge')).toHaveCount(4);

  await dragBetween(page, handle, editor.locator('[data-node-id="api"] rect'));

  await expect(editor.locator('path.edge[data-from="caller"][data-to="api"]')).toHaveCount(1);
  await expect(editor.locator('path.edge')).toHaveCount(5);
  await expect(editor.locator('[data-node-id="caller"] rect')).toHaveAttribute('x', '24');
});

test('C then Enter connects with the keyboard and a drop on the same box adds nothing', async ({ page, request }) => {
  const editor = await openEditor(page, request, 'connect-keys');
  await editor.locator('[data-node-id="session"]').focus();
  await page.keyboard.press('c');
  await expect(page.getByTestId('editor-note')).toContainText('press Enter');

  await editor.locator('[data-node-id="caller"]').focus();
  await page.keyboard.press('Enter');
  await expect(editor.locator('path.edge[data-from="session"][data-to="caller"]')).toHaveCount(1);
  await expect(page.getByTestId('rename-input')).toHaveCount(0);
  await expect(page.getByTestId('editor-note')).toHaveText(
    'Enter rename · S status · C connect · Delete remove · arrows move',
  );

  const api = editor.locator('[data-node-id="api"] rect');
  await dragBetween(page, page.getByTestId('handle-api'), api);
  await expect(editor.locator('path.edge')).toHaveCount(5);
  await expect(api).toHaveAttribute('x', '334');
});

test('the handles hide at twelve arrows and the toolbar says why', async ({ page, request }) => {
  const editor = await openEditor(page, request, 'connect-full');
  await expect(page.getByTestId('handle-caller')).toBeVisible();
  const pairs = [
    ['caller', 'refresh'],
    ['caller', 'api'],
    ['caller', 'session'],
    ['wrapper', 'session'],
    ['refresh', 'api'],
    ['api', 'session'],
    ['session', 'caller'],
    ['api', 'caller'],
  ];
  for (const [from, to] of pairs) {
    await editor.locator(`[data-node-id="${from}"]`).focus();
    await page.keyboard.press('c');
    await editor.locator(`[data-node-id="${to}"]`).focus();
    await page.keyboard.press('Enter');
  }

  await expect(editor.locator('path.edge')).toHaveCount(12);
  await expect(editor.locator('.handle')).toHaveCount(0);
  await expect(page.getByTestId('editor-note')).toHaveText('Diagrams hold at most 12 arrows');
});

test("S cycles the focused box's status and its fill", async ({ page, request }) => {
  const editor = await openEditor(page, request, 'status');
  const api = editor.locator('[data-node-id="api"]');
  await expect(api).toHaveAttribute('data-node-status', 'external');
  await api.focus();

  await page.keyboard.press('s');
  await expect(api).toHaveAttribute('data-node-status', 'reused');
  await expect(api.locator('rect')).toHaveAttribute('style', 'fill:var(--diagram-reused)');
  await expect(api).toBeFocused();

  await page.getByTestId('status-selected').click();
  await expect(api).toHaveAttribute('data-node-status', 'new');
  await expect(api.locator('rect')).toHaveAttribute('style', 'fill:var(--diagram-new)');
});

test('Status with nothing selected does nothing', async ({ page, request }) => {
  const editor = await openEditor(page, request, 'status-none');
  const status = page.getByTestId('status-selected');
  const statuses = () => editor.locator('[data-node-id]').evaluateAll((els) => els.map((el) => el.dataset.nodeStatus));
  await expect(status).toBeDisabled();
  const before = await statuses();

  await status.click({ force: true });
  expect(await statuses()).toEqual(before);

  await page.getByTestId('arrow-wrapper-api').click();
  await expect(status).toBeDisabled();
});

const edgePaths = (editor: Locator) => editor.locator('path.edge').evaluateAll((els) => els.map((el) => el.outerHTML));

test("Reset brings back the agent's boxes and arrows", async ({ page, request }) => {
  const editor = await openEditor(page, request, 'reset');
  const reset = page.getByTestId('reset-diagram');
  await expect(reset).toBeVisible();
  const original = await boxes(editor);
  const originalEdges = await edgePaths(editor);

  await editor.locator('[data-node-id="caller"]').focus();
  await page.keyboard.press('ArrowRight');
  await editor.locator('[data-node-id="api"]').focus();
  await page.keyboard.press('s');
  await editor.locator('[data-node-id="wrapper"]').focus();
  await page.keyboard.press('Delete');
  await expect(editor.locator('[data-node-id]')).toHaveCount(4);

  await reset.click();
  await expect(editor.locator('[data-node-id]')).toHaveCount(5);
  expect(await boxes(editor)).toEqual(original);
  expect(await edgePaths(editor)).toEqual(originalEdges);
  await expect(editor).toBeVisible();
});

test('Reset with no edits leaves the diagram as is', async ({ page, request }) => {
  const editor = await openEditor(page, request, 'reset-clean');
  const reset = page.getByTestId('reset-diagram');
  await expect(reset).toBeVisible();
  const original = await boxes(editor);
  const originalEdges = await edgePaths(editor);

  await reset.click();
  expect(await boxes(editor)).toEqual(original);
  expect(await edgePaths(editor)).toEqual(originalEdges);
  await expect(editor).toBeVisible();
});

async function rename(page: Page, box: Locator, label: string): Promise<void> {
  await box.dblclick();
  await page.getByTestId('rename-input').fill(label);
  await page.getByTestId('rename-input').press('Enter');
  await expect(box).toHaveAttribute('data-node-label', label);
}

test('Done editing shows the diagram as placed and it survives a reload', async ({ page, request }) => {
  const editor = await openEditor(page, request, 'reload');
  const api = editor.locator('[data-node-id="api"]');
  await rename(page, api, 'Upstream API');
  await editor.locator('[data-node-id="caller"]').focus();
  await page.keyboard.press('ArrowDown');
  await page.getByTestId('done-editing').click();

  const figure = page.getByTestId('block-opt-a').locator('figure.diagram');
  await expect(figure.locator('[data-node-id="api"]')).toHaveAttribute('data-node-label', 'Upstream API');
  await expect(figure.locator('[data-node-id="caller"] rect')).toHaveAttribute('y', '32');
  await page.reload();
  await expect(figure.locator('[data-node-id="api"]')).toHaveAttribute('data-node-label', 'Upstream API');
  await expect(figure.locator('[data-node-id="caller"] rect')).toHaveAttribute('y', '32');
  await page.getByTestId('edit-opt-a').click();
  await expect(api).toHaveAttribute('data-node-label', 'Upstream API');
  await expect(editor.locator('[data-node-id="caller"] rect')).toHaveAttribute('y', '32');

  await page.getByTestId('reset-diagram').click();
  await page.getByTestId('done-editing').click();
  await expect(figure.locator('[data-node-id="api"]')).toHaveAttribute('data-node-label', 'API');
  await page.reload();
  await page.getByTestId('edit-opt-a').click();
  await expect(api).toHaveAttribute('data-node-label', 'API');
});

test('the editor still works when sessionStorage throws', async ({ page, request }) => {
  await page.addInitScript(() => {
    const fail = () => {
      throw new Error('storage disabled');
    };
    Storage.prototype.getItem = fail;
    Storage.prototype.setItem = fail;
    Storage.prototype.removeItem = fail;
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const editor = await openEditor(page, request, 'no-storage');
  const api = editor.locator('[data-node-id="api"]');

  await rename(page, api, 'Upstream API');
  await page.getByTestId('reset-diagram').click();
  await expect(api).toHaveAttribute('data-node-label', 'API');
  await page.getByTestId('done-editing').click();
  await page.getByTestId('edit-opt-a').click();
  await expect(editor.locator('[data-node-id]')).toHaveCount(5);
  expect(errors).toEqual([]);
});

test('a live answer on the block being edited keeps the editor and its edits', async ({ page, request }) => {
  const id = await openPlan(page, request, 'live');
  await page.getByTestId('edit-opt-a').click();
  const editor = page.getByTestId('editor-opt-a');
  await rename(page, editor.locator('[data-node-id="api"]'), 'Upstream API');

  const asked = await request.post(`/api/plans/${id}/messages`, {
    data: { clientId: 'e2e-live-edit-0001', kind: 'ask', blockId: 'opt-a', text: 'why the wrapper?' },
  });
  expect(asked.ok()).toBe(true);
  const answered = await request.post(`/api/plans/${id}/answers`, { data: { questionId: 'm-1', md: 'Because.' } });
  expect(answered.ok()).toBe(true);

  await expect(page.locator('[data-block="opt-a"] [data-state="answered"]')).toContainText('Because.');
  await expect(editor).toBeVisible();
  await expect(editor.locator('[data-node-id="api"]')).toHaveAttribute('data-node-label', 'Upstream API');
  await expect(page.getByTestId('block-opt-a').locator('figure.diagram')).toHaveCount(0);
});

const postedMessage = (page: Page, id: string) =>
  page.waitForRequest((req) => req.method() === 'POST' && req.url().endsWith(`/api/plans/${id}/messages`));

test('Ask about my version posts the edited graph and the thread shows Your version', async ({ page, request }) => {
  const id = await openPlan(page, request, 'ask-version');
  await page.getByTestId('edit-opt-a').click();
  const editor = page.getByTestId('editor-opt-a');
  await rename(page, editor.locator('[data-node-id="api"]'), 'Upstream API');
  await page.getByTestId('arrow-wrapper-api').click();
  await page.keyboard.press('Delete');
  await editor.locator('[data-node-id="caller"]').focus();
  await page.keyboard.press('ArrowDown');

  await expect(page.getByTestId('ask-version')).toBeVisible();
  await page.getByTestId('ask-version').click();
  await expect(page.getByTestId('composer')).toBeVisible();
  await expect(page.locator('#composer .composer-head')).toContainText('ASK ABOUT');
  await expect(page.getByTestId('composer-proposal')).toHaveText('With your edited diagram · 2 changes');

  await page.getByTestId('composer-input').fill('why not this?');
  const posted = postedMessage(page, id);
  await page.getByTestId('composer-input').press('Enter');
  const body = (await posted).postDataJSON();
  expect(body).toMatchObject({ kind: 'ask', blockId: 'opt-a', text: 'why not this?' });
  expect(body.proposal.nodes).toContainEqual({ id: 'api', label: 'Upstream API', status: 'external' });
  for (const node of body.proposal.nodes) expect(Object.keys(node).sort()).toEqual(['id', 'label', 'status']);
  expect(body.proposal.edges).toHaveLength(3);
  expect(body.proposal.edges).not.toContainEqual(expect.objectContaining({ from: 'wrapper', to: 'api' }));

  const proposal = page.locator('[data-block="opt-a"] [data-testid^="proposal-"]');
  await expect(proposal).toContainText('YOUR VERSION');
  await expect(proposal).toContainText('Upstream API');
  await expect(editor).toHaveCount(0);
  await page.reload();
  await page.getByTestId('edit-opt-a').click();
  await expect(editor.locator('[data-node-id="api"]')).toHaveAttribute('data-node-label', 'API');
});

test('an unchanged diagram sends no proposal', async ({ page, request }) => {
  const id = await openPlan(page, request, 'ask-unchanged');
  await page.getByTestId('edit-opt-a').click();
  await page.getByTestId('editor-opt-a').locator('[data-node-id="caller"]').focus();
  await page.keyboard.press('ArrowDown');

  await expect(page.getByTestId('ask-version')).toBeVisible();
  await page.getByTestId('ask-version').click();
  await expect(page.getByTestId('composer')).toBeVisible();
  await expect(page.getByTestId('composer-proposal')).toBeHidden();

  await page.getByTestId('composer-input').fill('is this fine?');
  const posted = postedMessage(page, id);
  await page.getByTestId('composer-input').press('Enter');
  const body = (await posted).postDataJSON();
  expect(body).toMatchObject({ kind: 'ask', blockId: 'opt-a', text: 'is this fine?' });
  expect(body).not.toHaveProperty('proposal');
});
