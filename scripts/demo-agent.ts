import { resolve } from 'node:path';
import { EXAMPLES } from '../src/cli/examples';
import type { errorOutput, PollMessage, PollOutput } from '../src/core/output';

type PollDocument = PollOutput | ReturnType<typeof errorOutput>;

const REPO_ROOT = resolve(import.meta.dir, '..');
const CLI = resolve(REPO_ROOT, 'bin/pinpoint.ts');
const POLL_TIMEOUT_MS = '4000';
const LISTED_CHANGES = 3;
const CHANGE_MAX = 60;

const [firstArg, ...flags] = process.argv.slice(2);
if (firstArg === undefined || firstArg.startsWith('-')) {
  process.stderr.write('usage: bun scripts/demo-agent.ts <plan-id> [--once]\n');
  process.exit(2);
}
const planId: string = firstArg;
const once = flags.includes('--once');

function log(line: string): void {
  process.stderr.write(`demo-agent: ${line}\n`);
}

async function cli(args: string[], stdin?: string): Promise<{ code: number; stdout: string }> {
  const child = Bun.spawn([process.execPath, CLI, ...args], {
    cwd: REPO_ROOT,
    env: process.env,
    stdin: stdin === undefined ? 'ignore' : Buffer.from(stdin),
    stdout: 'pipe',
    stderr: 'ignore',
  });
  const [stdout, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  return { code, stdout };
}

// Three changes cut to 60 characters keep the answer under ANSWER_MAX even beside a full excerpt.
function changeList(changes: string[] = []): string {
  if (changes.length === 0) return '';
  const items = changes.slice(0, LISTED_CHANGES).map((change) => `- ${change.slice(0, CHANGE_MAX)}`);
  const more = changes.length > LISTED_CHANGES ? '\n- …' : '';
  return `\n\nIn your version you:\n\n${items.join('\n')}${more}`;
}

function cannedAnswer(message: PollMessage): string {
  const echo = message.excerpt === undefined ? '' : `\n\nYou pointed at: *${message.excerpt.slice(0, 200)}*`;
  const followup = message.thread?.length ? `Follow-up ${message.thread.length + 1} in this thread: ` : '';
  const changes = changeList(message.proposal_changes);
  return `${followup}Short answer from the demo agent: **yes**, and it reuses what is already there.${echo}${changes}`;
}

function cannedSteps(optionId: string): string {
  return JSON.stringify({ ...EXAMPLES.steps, optionId });
}

async function handle(message: PollMessage): Promise<boolean> {
  if (message.kind === 'ask') {
    log(`answering ${message.id}`);
    const answered = await cli(['answer', planId, '--question', message.id, '--file', '-'], cannedAnswer(message));
    return answered.code === 0;
  }
  if (message.kind === 'choose' && message.option_id !== undefined) {
    log(`appending steps for ${message.option_id}`);
    const appended = await cli(
      ['append-steps', planId, message.option_id, '--file', '-'],
      cannedSteps(message.option_id),
    );
    return appended.code === 0;
  }
  return true;
}

while (true) {
  const polled = await cli(['poll', planId, '--timeout-ms', POLL_TIMEOUT_MS]);
  let document: PollDocument;
  try {
    document = JSON.parse(polled.stdout) as PollDocument;
  } catch {
    log(`poll printed no JSON (exit ${polled.code})`);
    process.exit(1);
  }
  if (document.status === 'error') {
    log(`poll failed: ${JSON.stringify(document)}`);
    process.exit(1);
  }
  if (document.status === 'browser_closed') {
    log(document.next_step);
    process.exit(0);
  }
  for (const message of document.messages) {
    if (!(await handle(message))) {
      log(`could not handle ${message.id}`);
      process.exit(1);
    }
  }
  if (document.status === 'done') {
    log('the user is done');
    process.exit(0);
  }
  if (once && document.status === 'messages') process.exit(0);
}
