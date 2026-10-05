# Pinpoint

Pinpoint turns "plan this change" into a web page of labelled blocks instead of a wall of text. The agent (Claude Code) reads the codebase first, draws three ways to do the job, marks one as recommended, and opens the page in your browser.

You point at any block and ask a question or choose an option. The agent stays on the line through `pinpoint watch`, a long-poll loop to a small helper server on your laptop that Claude Code's Monitor tool turns into chat events, answers that block only, and everything else on the page stays byte-identical. Nothing leaves the machine: fonts, scripts and styles are served from `127.0.0.1`. The full design is in [docs/design.md](docs/design.md).

## Install

Bun is pinned in `mise.toml`. If mise is not activated in your shell, prefix every `bun` command below with `mise x --`.

```sh
mise install
bun install
bun run setup:e2e   # Chromium for the Playwright suite
```

Install the Claude Code skill so the agent knows when and how to use Pinpoint:

```sh
bun bin/pinpoint.ts skill --install
```

This writes `~/.claude/skills/pinpoint/SKILL.md` with this checkout's absolute invocation baked in, so Claude Code does not prompt for each command.

## The agent loop

1. `pinpoint example plan` prints the plan shape; the agent fills it with three options after reading the code.
2. `pinpoint open <file>` validates the plan, starts the helper if needed and opens the browser.
3. `pinpoint watch <plan-id>` runs under Claude Code's Monitor tool and prints one JSON line per batch of browser messages, so each ask or choose wakes the agent with the message already in hand. It exits on hand-back or a closed tab; `pinpoint poll` is the single-shot version.
4. The agent answers with `answer`, `append-steps` or `patch-block`, then ends its turn; the watch keeps listening.
5. Every command prints one JSON document whose `next_step` says what to run next.

`pinpoint help` lists every command. The CLI entry is `bin/pinpoint.ts`; run it as `bun bin/pinpoint.ts <cmd>`, or as `pinpoint <cmd>` once linked.

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `PINPOINT_PORT` | `4777` | Helper port on 127.0.0.1 |
| `PINPOINT_STATE_DIR` | `~/.pinpoint` | Plans and `helper.log` |
| `PINPOINT_NO_OPEN` | unset | `1` skips opening the browser |
| `PINPOINT_IDLE_TIMEOUT_MS` | `1800000` | Helper exits after this long with no activity |
| `PINPOINT_POLL_MAX_WAIT_MS` | `1500000` | Longest a single poll waits |
| `PINPOINT_BROWSER_GRACE_MS` | `90000` | How long a poll tolerates a missing browser tab |
| `PINPOINT_INVOCATION` | detected | Command prefix printed in `next_step` |

If the helper misbehaves, read `<state dir>/helper.log`.

## Tests

| Level | Proves | Command |
|---|---|---|
| L0 static | types and style | `bun run typecheck && bun run check` |
| L1 unit | every pure module | `bun run test:unit` |
| L2 http | every route, in-process | `bun run test:http` |
| L3 socket | heartbeat bytes, abort, idle shutdown | `bun test test/http/socket.test.ts` |
| L4 cli | every subcommand's JSON and exit code | `bun run test:cli` |
| L5 subprocess and daemon | one JSON document on real stdout, detached spawn | `bun test test/cli/subprocess.test.ts`, `bun run test:daemon` |
| L6 browser | DOM glue, offline, keyboard, visual | `bun run test:e2e` |

`bun test` runs L1 to L5 with no network and no browser and enforces 90% line and function coverage. The full matrix is in [docs/design.md section 8](docs/design.md#8-testing-strategy).

`bun run verify` runs check, typecheck, `bun test --coverage`, `skill --check` and e2e in order. The visual baselines are macOS-specific (`-darwin` suffix), so the visual spec only passes on macOS.

## Demo

```sh
bun run demo                          # opens the auth-refresh plan in the browser
bun run demo:agent -- auth-refresh    # in a second terminal: a scripted agent answers asks and choices
```

Ask a question or choose an option in the browser and the scripted agent replies through the real CLI.

## Dev loop

```sh
bun run dev        # helper in the foreground, restarted by bun --watch
pinpoint stop      # after edits, so the next command spawns a fresh helper
```

The detached helper that `pinpoint open` starts keeps running the code it started with; `pinpoint stop` makes the next command spawn one from your edits.
