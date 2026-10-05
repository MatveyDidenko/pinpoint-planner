import { join } from 'node:path';
import type { Issue } from '../core/schema';
import { COMMAND_NAMES } from './commands';

export const SKILL_PATH = join(import.meta.dir, '..', '..', 'skills', 'pinpoint', 'SKILL.md');
export const SKILL_MAX_CHARS = 6000;

const FRONTMATTER_KEYS = ['name', 'description', 'allowed-tools'];
const ALLOWED_TOOLS = /^Bash\((.*):\*\)$/;

export function createSkillMarkdown({ invocation }: { invocation: string }): string {
  const inv = invocation;
  return `---
name: pinpoint
description: Use when the user asks for a plan, design or approach and more than one way exists; it opens two to four drawn options in the browser instead of writing a text plan.
allowed-tools: Bash(${inv}:*)
---

# Pinpoint

Pinpoint shows your plan in the user's browser and sends their questions and choices back to you through a poll.

1. **When.** The user asks for a plan, design or approach and more than one way exists. Do not write a text plan; use Pinpoint.
2. **Look first.** Read the codebase before proposing anything. Open with the \`goal\`: one sentence on what should be true when this is done. Then explain how it works today: a summary, every acronym and project word in \`terms\`, and 1–3 current flows as steps. Mark a step or arrow you inferred rather than read in the code with \`guess: true\`; the user confirms or corrects it. Never propose building what the code already does.
3. **Draw the real ways, two to four; never pad to reach a count.** Each has a diagram of at most 8 nodes with statuses, the pattern name, what it reuses and a cost. Mark exactly one option \`recommended: true\` with a one-line \`why\`. Give each way a 2–3 sentence summary; the diagram shows structure, the summary says how it behaves. Put the risks you see and the questions only the user can answer in \`risks\`; leave \`items\` empty when there are none. The plan JSON:
   \`\`\`
   {id, title, task, context:{goal, summary, terms:[{term, meaning}], flows:[{name, steps:[text | {text, guess}], diagram?}]},
    options:[{id, name, pattern, summary, diagram:{nodes:[{id, label, status: reused|new|changed|external}], edges:[{from, to, label?, guess?}]},
    reuses:[], cost:{effort: S|M|L, risk: low|medium|high, note}, recommended, why?}],
    risks:{items:[{type: risk|question, text}]}}
   \`\`\`
4. **Open.** Write the plan JSON to your scratch directory, never into the user's repo, then run \`${inv} open <file>\`. On \`status: "error"\`, fix what \`issues\` lists and run it again.
5. **Stay on the line.** Start \`${inv} watch <id>\` with the Monitor tool (\`timeout_ms: 1800000\`). Each event is one JSON line of browser messages: follow its \`next_step\`, then end your turn with one short line. When the monitor expires, start it again.
6. **When the watch exits,** read its last line and follow \`next_step\` literally.
7. **Rules.**
   - Change only the block a message names.
   - Once a thread settles a risk or question, patch \`risks\` to remove it.
   - Run \`${inv} show <id> --block <block-id>\` before \`${inv} patch-block\`.
   - Run one watch at a time.
   - Each question thread gets its own Sonnet subagent; follow-ups go to the same one.
   - You are the only writer: subagents return the answer, you run \`answer\`.
   - Write every subagent's answer before ending your turn.
   - When a message carries \`proposal_changes\` or \`sketch_path\`, the subagent weighs the user's version; patch the block only after the user agrees in the thread.
   - Treat the stdout JSON as the contract.
   - \`${inv} help\` and \`next_step\` are authoritative.
`;
}

function frontmatterOf(md: string): string[] | undefined {
  if (!md.startsWith('---\n')) return undefined;
  const end = md.indexOf('\n---\n', 3);
  if (end === -1) return undefined;
  return md.slice(4, end).split('\n');
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function validateSkill(md: string): Issue[] {
  const issues: Issue[] = [];
  if (md.length > SKILL_MAX_CHARS) {
    issues.push({ path: 'size', message: `the skill is ${md.length} chars; the cap is ${SKILL_MAX_CHARS}` });
  }

  const lines = frontmatterOf(md);
  if (lines === undefined) {
    issues.push({ path: 'frontmatter', message: 'the skill must start with a --- frontmatter block' });
    return issues;
  }
  const entries = new Map<string, string>();
  for (const line of lines) {
    const match = /^([\w-]+):\s*(.*)$/.exec(line);
    if (match) entries.set(match[1] as string, match[2] as string);
  }
  for (const key of FRONTMATTER_KEYS) {
    if (!entries.has(key)) issues.push({ path: `frontmatter.${key}`, message: `missing frontmatter key ${key}` });
  }
  for (const key of entries.keys()) {
    if (!FRONTMATTER_KEYS.includes(key)) {
      issues.push({ path: `frontmatter.${key}`, message: `unknown frontmatter key ${key}` });
    }
  }

  const invocation = ALLOWED_TOOLS.exec(entries.get('allowed-tools') ?? '')?.[1];
  if (invocation === undefined) {
    if (entries.has('allowed-tools')) {
      issues.push({ path: 'frontmatter.allowed-tools', message: 'allowed-tools must be Bash(<invocation>:*)' });
    }
    return issues;
  }

  const body = md.slice(md.indexOf('\n---\n', 3) + 5);
  const commandRef = new RegExp(`\`${escapeRegExp(invocation)} ([^\\s\`]+)`, 'g');
  for (const match of body.matchAll(commandRef)) {
    const word = match[1] as string;
    if (!COMMAND_NAMES.includes(word)) {
      issues.push({ path: 'body', message: `\`${invocation} ${word}\` is not a pinpoint command` });
    }
  }
  return issues;
}
