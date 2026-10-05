export interface CommandDoc {
  name: string;
  usage: string;
  summary: string;
  flags: string[];
}

export const COMMANDS: CommandDoc[] = [
  {
    name: 'help',
    usage: 'pinpoint [help]',
    summary: 'Show the helper status, open plans and these commands.',
    flags: [],
  },
  {
    name: 'example',
    usage: 'pinpoint example [plan|steps|answer|block]',
    summary: 'Print the fixture JSON for that shape.',
    flags: [],
  },
  {
    name: 'open',
    usage: 'pinpoint open <plan.json|-> [--no-open]',
    summary: 'Validate a plan, ensure the helper is running, store the plan and open the browser.',
    flags: ['--no-open'],
  },
  {
    name: 'poll',
    usage: 'pinpoint poll <plan-id> [--timeout-ms N]',
    summary: 'Wait for browser messages, a hand-back, the wait cap or a closed tab.',
    flags: ['--timeout-ms'],
  },
  {
    name: 'watch',
    usage: 'pinpoint watch <plan-id>',
    summary:
      'Print one JSON line per batch of new browser messages until hand-back or a closed tab; run it with Monitor.',
    flags: [],
  },
  {
    name: 'answer',
    usage: 'pinpoint answer <plan-id> --question <mid> (--text "…" | --file <p>|-) [--diagram <graph.json>]',
    summary: 'Answer one question in the block it was asked on.',
    flags: ['--question', '--text', '--file', '--diagram'],
  },
  {
    name: 'append-steps',
    usage: 'pinpoint append-steps <plan-id> <option-id> --file <steps.json>|-',
    summary: 'Append the steps block for a chosen option.',
    flags: ['--file'],
  },
  {
    name: 'patch-block',
    usage: 'pinpoint patch-block <plan-id> <block-id> --file <block.json>|-',
    summary: 'Replace the content of one block and leave the rest untouched.',
    flags: ['--file'],
  },
  {
    name: 'show',
    usage: 'pinpoint show <plan-id> [--block <id>]',
    summary: 'Print the current stored plan or block JSON.',
    flags: ['--block'],
  },
  {
    name: 'ack',
    usage: 'pinpoint ack <plan-id> <message-id>...',
    summary: 'Mark messages as handled without answering them.',
    flags: [],
  },
  { name: 'status', usage: 'pinpoint status <plan-id>', summary: 'Print the state of one plan.', flags: [] },
  {
    name: 'serve',
    usage: 'pinpoint serve [--port N] [--state-dir D] [--idle-ms N]',
    summary: 'Run the helper in the foreground.',
    flags: ['--port', '--state-dir', '--idle-ms'],
  },
  { name: 'stop', usage: 'pinpoint stop', summary: 'Stop the running helper.', flags: [] },
  {
    name: 'skill',
    usage: 'pinpoint skill [--check | --install | --out <path>]',
    summary: 'Generate, verify or install the Claude Code skill.',
    flags: ['--check', '--install', '--out'],
  },
];

export const COMMAND_NAMES: readonly string[] = COMMANDS.map((command) => command.name);
