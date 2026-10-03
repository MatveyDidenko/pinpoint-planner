#!/usr/bin/env bun
import { realIo } from '../src/cli/io';
import { run, runSignalCleanups } from '../src/cli/run';

const INTERRUPT_HINT = 'poll interrupted; nothing was lost, run the same command again\n';
const SIGNAL_EXIT_CODES = { SIGINT: 130, SIGTERM: 143 } as const;

let signalExitCode: number | undefined;

for (const signal of Object.keys(SIGNAL_EXIT_CODES) as (keyof typeof SIGNAL_EXIT_CODES)[]) {
  process.on(signal, async () => {
    if (signalExitCode !== undefined) return;
    signalExitCode = SIGNAL_EXIT_CODES[signal];
    const closedHelper = await runSignalCleanups();
    if (!closedHelper) process.stderr.write(INTERRUPT_HINT);
    process.exit(signalExitCode);
  });
}

const code = await run(process.argv.slice(2), realIo());
process.exit(signalExitCode ?? code);
