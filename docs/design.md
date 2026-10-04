# Pinpoint — design

Pinpoint turns "plan this change" into a web page of labelled blocks instead of a wall of text. The
agent (Claude Code) looks at the codebase first, draws two to four ways to do the job, picks one, and then
answers questions block by block while the user points at the page. The agent stays "on the line"
through a long-poll to a small helper server on the laptop; nothing leaves the machine.

This document is the reference the step plan (`.plans/2026-10-03_pinpoint-mvp.md`) executes against.
Where the plan and this document disagree, the plan wins and this document gets fixed.

## 1. Principles

1. **The plan is data, not a document.** The agent writes JSON blocks; one deterministic renderer
   turns them into HTML. A patch is a data replace plus one block re-render. "Everything else stays
   byte-identical" holds by construction and is checked at runtime by hashing the untouched blocks
   before and after every mutation.
2. **Every side effect enters through one seam.** Clock, timers, persistence, fetch, process spawn
   and browser-open are injected, so `bun test` drives the real Hono app, the real CLI and the real
   long-poll in-process with no port, no sleep and no browser. Playwright covers only the DOM glue.
3. **No walls of text is a schema rule.** Every sentence field is capped at 160 characters, answers
   at 600, exchanges per block at 40. The renderer cannot produce a paragraph the schema did not
   allow.
4. **Delivery never destroys.** A poll marks messages delivered; only an answer, appended steps,
   a hand-back or an explicit ack retires them. A killed agent re-runs the poll and loses nothing.
5. **Offline and private.** Fonts, scripts and styles are served from the helper on 127.0.0.1. The
   e2e suite asserts no request leaves loopback.

## 2. Stack

| Piece | Choice | Why |
|---|---|---|
| Runtime | Bun 1.3.13, pinned in `mise.toml` | `bun test`, `Bun.serve`, `Bun.build`; bun is mise-managed on the dev machine and not on PATH otherwise |
| HTTP | `hono@^4.13` | `app.request()` runs routes in-process; verified streaming bodies and `AbortSignal` propagation on Bun 1.3.13 |
| Validation | `zod@^4` | only `z.object/enum/array/regex/superRefine/safeParse`; issues map to `{path, message}` |
| Fonts | `@fontsource/ibm-plex-sans`, `@fontsource/ibm-plex-mono`, `@fontsource/source-serif-4` (5.3.0) | the proposal's typography, served offline from `node_modules` |
| Lint/format | `@biomejs/biome@^2` | single quotes, 2 spaces, 120 cols; `bun run check:fix` |
| Types | `typescript@^5`, `@types/bun` | one `tsconfig.json` with `lib: ["ESNext", "DOM"]` so `src/client` typechecks |
| E2E | `@playwright/test@^1.63` | runs under Node 24 (present); Chromium via `bunx playwright install chromium` |

Deliberately absent: mermaid (diagrams are server-rendered SVG from a node/edge schema), sqlite
(one JSON file per plan), ws (SSE), happy-dom/jsdom (no DOM in `bun test`), CDNs.

`Bun.serve` is started with `idleTimeout: 0` because its 10 s default closes a quiet streaming
response; the poll heartbeat is 5 s as a second line of defence.

## 3. Repository layout

```
bin/pinpoint.ts              entry: run(argv, realIo()); SIGINT/SIGTERM → stderr hint, exit 130/143
src/core/schema.ts           zod schemas, parse* functions, Result/Issue, limits
src/core/types.ts            PlanState, Block union, Exchange, Message, Transition
src/core/state.ts            pure transitions and derivations
src/core/presence.ts         computePresence + labels (shared with the client)
src/core/hash.ts             sha16, untouchedHash
src/core/markdown.ts         whitelist markdown emitter
src/core/diagram/layout.ts   layered left-to-right layout
src/core/diagram/svg.ts      SVG renderer
src/core/render/esc.ts       esc, attr, jsonScript
src/core/render/blocks.ts    renderBlock per kind, renderExchange
src/core/render/page.ts      renderPage, renderHome
src/core/output.ts           every CLI JSON document and next_step template; invocation prefix
src/shared/frames.ts         SSE frame types, Boot, PostMessageResponse, shouldApply
src/server/persistence.ts    Persistence interface; memory and file (tmp+rename) implementations
src/server/store.ts          PlanStore: apply a transition, save, return
src/server/stream.ts         openStream(): heartbeat stream with one cleanup path
src/server/poll-hub.ts       waiters per plan, wake, listen → Response
src/server/sse-hub.ts        clients per plan, encodeFrame, subscribe, broadcast
src/server/timers.ts         KeyedTimer (grace) and IdleWatch
src/server/guard.ts          loopback hostname check, Origin check, body limit
src/server/app.ts            createApp(deps): all routes
src/server/assets.ts         Bun.build of the client, styles.css, font allowlist, STUB_ASSETS
src/server/start.ts          serveOptions(), startServer(opts)
src/cli/commands.ts          COMMANDS catalogue
src/cli/args.ts              argv parser
src/cli/io.ts                CliIo seam, realIo(), configFrom(env), detectInvocation()
src/cli/api.ts               typed HTTP client, CliError mapping
src/cli/ensure-server.ts     find-or-start the helper
src/cli/daemon.ts            buildSpawnArgs, spawnDaemon (the only detached spawn)
src/cli/open-browser.ts      openCommandFor(platform), openBrowser
src/cli/body.ts              --text / --file / --file -
src/cli/skill.ts             createSkillMarkdown, validateSkill, install path
src/cli/run.ts               run(argv, io): dispatch, one JSON document on stdout
src/client/*.ts, styles.css  browser code, bundled at server start and inlined
skills/pinpoint/SKILL.md     committed, generated, checked
scripts/demo-agent.ts        scripted agent for demos and the top-to-bottom e2e
test/unit, test/http, test/cli, test/daemon, test/e2e, test/helpers, test/fixtures
```

## 4. Data model

Two shapes: what the agent writes (input, validated by zod) and what the helper stores (state).
The agent never writes HTML and never names findings, verdict or steps blocks; the server derives
them.

```ts
// ---------- input ----------
export const PLAN_ID = /^[a-z0-9][a-z0-9-]{1,63}$/;
export const BLOCK_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;        // option ids; not 'findings' | 'verdict', not /^steps-/
export const NODE_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
export const SENTENCE_MAX = 160; export const ANSWER_MAX = 600; export const EXCERPT_MAX = 200;
export const OPTION_MIN = 2; export const OPTION_MAX = 4; export const MAX_NODES = 8; export const MAX_EDGES = 12;
export const MAX_FINDINGS = 12; export const MAX_STEPS = 12; export const MAX_EXCHANGES = 40;

type Status = 'reused' | 'new' | 'changed' | 'external';
interface GraphNode { id: string; label: string /* 1..40 */; status: Status }
interface GraphEdge { from: string; to: string; label?: string /* ≤24 */ }   // endpoints must exist; no self loop
interface Graph { nodes: GraphNode[] /* 1..MAX_NODES, unique ids */; edges: GraphEdge[] /* ≤MAX_EDGES */ }

interface Finding { path: string /* ≤120 */; role: 'reuse' | 'touch' | 'context'; note: string /* sentence */ }
interface Cost { effort: 'S' | 'M' | 'L'; risk: 'low' | 'medium' | 'high'; note: string /* sentence */ }
interface Step { title: string /* sentence */; touches: string[] /* ≤8 */; test: string /* sentence */ }

interface FindingsInput { summary: string /* sentence */; items: Finding[] /* 1..MAX_FINDINGS */; diagram?: Graph }
interface OptionInput {
  id: string; name: string /* ≤60 */; pattern: string /* ≤60, what engineers call it */;
  diagram: Graph; reuses: string[] /* ≤8 */; cost: Cost; recommended: boolean; why?: string /* sentence; required iff recommended */
}
interface PlanInput { id: string; title: string /* ≤80 */; task: string /* sentence */; findings: FindingsInput; options: OptionInput[] /* two to four (OPTION_MIN..OPTION_MAX), unique ids, exactly one recommended */ }
interface StepsInput { optionId: string; steps: Step[] /* 1..MAX_STEPS */ }
interface AnswerInput { questionId: string; md: string /* 1..ANSWER_MAX */; diagram?: Graph }
type BlockInput = ({ kind: 'findings' } & FindingsInput) | ({ kind: 'option' } & OptionInput) | { kind: 'verdict'; why: string };
interface BrowserMessage {
  clientId: string /* ^[A-Za-z0-9_-]{8,64}$, browser-minted idempotency key */;
  kind: 'ask' | 'choose' | 'done'; blockId?: string; optionId?: string;
  text: string /* ask: 1..ANSWER_MAX; choose/done: '' */; excerpt?: string /* ≤EXCERPT_MAX */;
  threadId?: string /* ask only: reply into that thread */
}

// ---------- state (persisted as <stateDir>/plans/<id>.json) ----------
interface Exchange { id: string /* == ask message id */; threadId: string /* == the thread's first ask id */;
  question: string; excerpt?: string; askedAt: string;
  state: 'asked' | 'delivered' | 'answered'; answer?: { md: string; diagram?: Graph; at: string } }
interface BlockBase { id: string; kind: Block['kind']; label: string; rev: number /* 1, +1 per touch */;
  touchedAt: number /* plan revision when last touched */; qa: Exchange[] }
interface FindingsBlock extends BlockBase { kind: 'findings'; summary: string; items: Finding[]; diagram?: Graph }
interface OptionBlock extends BlockBase { kind: 'option'; letter: 'A' | 'B' | 'C' | 'D'; name: string; pattern: string; diagram: Graph;
  reuses: string[]; cost: Cost; recommended: boolean; why?: string; steps: { state: 'none' | 'requested' | 'ready'; blockId?: string } }
interface VerdictBlock extends BlockBase { kind: 'verdict'; optionId: string; letter: 'A' | 'B' | 'C' | 'D'; optionName: string; why: string }
interface StepsBlock extends BlockBase { kind: 'steps'; optionId: string; letter: 'A' | 'B' | 'C' | 'D'; optionName: string; steps: Step[] }
type Block = FindingsBlock | OptionBlock | VerdictBlock | StepsBlock;

interface Message { id: string /* 'm-<n>' */; clientId: string; kind: 'ask' | 'choose' | 'done'; blockId?: string; optionId?: string;
  threadId?: string /* set on every ask */; text: string; excerpt?: string; at: string; deliveredAt?: string; ackedAt?: string }
interface PlanState {
  schemaVersion: 1;
  plan: { id: string; title: string; task: string; blocks: Block[] /* render order */; openedAt: string };
  revision: number;            // +1 on every transition
  nextMessageSeq: number;      // message ids are 'm-<seq>'
  review: 'open' | 'handed-back';
  messages: Message[];
}
interface Transition { state: PlanState; touched: string[]; appended?: { blockId: string; after: string | null } }
```

Block order is fixed: `findings`, options A–D (one letter per option, in input order), `verdict`, then `steps-<optionId>` blocks in the order
they were appended. The page renders them under four numbered stages: 01 What's already here,
02 Two ways / Three ways / Four ways (titled by the option count), 03 The pick, 04 Steps.

Threads: an ask without `threadId` starts a thread whose id is its own message id (`m-7`). An ask with
`threadId` is a follow-up in that thread on the same block, accepted only once the thread's last
exchange is answered, so a thread holds at most one open question. A block's `qa` stays one flat list in
ask order; the thread is the `threadId` on each exchange.

### Derivations (`src/core/state.ts`)

- `blockLabel`: findings → "What's already here"; option → "Way B · <name>"; verdict → "The pick";
  steps → "Steps · Way A · <name>".
- `pendingMessages(s)`: messages without `ackedAt`, in `at` order. This filter *is* the feedback queue.
- `untouchedHash(plan, touched, renderBlock)`: sha16 of the rendered untouched blocks joined by `\n`
  in plan order. Computed before and after every mutating transition; a mismatch is a 500
  `INVARIANT_VIOLATION` and the state is not saved.

### Transitions

Every transition returns a new `PlanState`; untouched blocks keep their object identity (tests assert
`toBe`). `revision` increments once per transition. `touched` lists the block ids whose `rev` and
`touchedAt` moved.

| Transition | Effect | Errors (`StateError.code`) |
|---|---|---|
| `openPlan(input, now)` | blocks `[findings, A, B, C, verdict]`, all `rev 1`, `touchedAt 1`, `revision 1`, `review 'open'` | — |
| `replacePlan(s, input, now)` | rebuild blocks from input; carry `qa` over by matching block id; drop `steps-*` blocks; reset `option.steps` to `none`; ack pending messages whose block no longer exists and return them as `dropped`; keep `revision`, `nextMessageSeq`, `review` | — |
| `postMessage(s, m, now)` | `ask`: push Message, push Exchange `asked` on the block with `threadId = m.threadId ?? id`, touched `[blockId]`. `choose`: option `steps.state = 'requested'`, touched `[optionId]`. `done`: `review = 'handed-back'`, touched `[]`. Same `clientId` → returns the stored message, `duplicate: true`, state unchanged (`toBe`) | `NOT_FOUND` (also a `threadId` with no exchange on that block), `BLOCK_FULL` (41st exchange), `THREAD_BUSY` (the thread's last exchange is not `answered`), `NOT_AN_OPTION`, `STEPS_EXIST` (choose when `ready`), `HANDED_BACK` (ask/choose after done) |
| `markDelivered(s, ids, now)` | set `deliveredAt` where unset; asked exchanges → `delivered`; touched = those blocks | — |
| `ackMessages(s, ids, now)` | set `ackedAt`; touched `[]` | `NOT_FOUND` |
| `attachAnswer(s, a, now)` | exchange → `answered` with answer; acks the ask message; touched `[blockId]` | `NOT_FOUND`, `ALREADY_ANSWERED` |
| `appendSteps(s, st, now)` | new `StepsBlock { id: 'steps-' + optionId, rev 1 }` appended last; option `steps = { state: 'ready', blockId }`; acks pending `choose` messages for that option; touched `[optionId, stepsId]`; `appended = { blockId, after: previous last id }` | `NOT_FOUND`, `NOT_AN_OPTION`, `STEPS_EXIST` |
| `patchBlock(s, blockId, input, now)` | replace content fields, keep `qa`, `rev + 1`; when the recommended option's `name` or `why` changes, the verdict block is re-derived and included in `touched` | `NOT_FOUND`, `KIND_MISMATCH`, `RECOMMENDED_LOCKED` (input flips `recommended`) |

The hand-back rule: when a poll delivers a `done` message, the server acks *every* pending message in
the same transition and reports the unanswered question ids in `next_step`, so the agent is told
exactly what it never got to.

### Presence (`src/core/presence.ts`, imported by server and client)

```ts
type Presence = 'waiting' | 'listening' | 'working' | 'handed-back';
computePresence({ review, messages, pollers }):
  review === 'handed-back' → 'handed-back'
  any message with deliveredAt && !ackedAt → 'working'
  pollers > 0 → 'listening'
  else → 'waiting'
presenceLabel(p, undelivered): 'Agent not on the line' (+ ' · 2 waiting' when undelivered > 0) | 'Agent on the line' | 'Agent working…' | 'Handed back to the agent'
```

## 5. Protocol

### CLI conventions

- stdout is exactly one JSON document, always. stderr gets a one-line banner for `poll` and the
  interrupt hint. Exit 0 for every non-error status, 1 for `status: "error"`, 130/143 on SIGINT/SIGTERM.
- Every document carries `next_step` before any large field. Poll key order is
  `status, plan_id, messages, next_step, page` and is pinned by a test.
- Multi-line bodies come from `--file <path>` or `--file -` (stdin). `--text` is for one-liners.
- `next_step` prints commands with the invocation prefix the CLI was actually started with
  (`detectInvocation(argv1, execPath, env)`): `pinpoint` when run through the linked bin,
  `<bun path> <abs path>/bin/pinpoint.ts` otherwise, or `PINPOINT_INVOCATION` when set.
- Env: `PINPOINT_PORT` (4777), `PINPOINT_STATE_DIR` (`~/.pinpoint`), `PINPOINT_NO_OPEN=1`,
  `PINPOINT_IDLE_TIMEOUT_MS` (1800000), `PINPOINT_POLL_MAX_WAIT_MS` (1500000 = 25 min, under Claude
  Code's 30-minute background default), `PINPOINT_BROWSER_GRACE_MS` (90000), `PINPOINT_INVOCATION`.

### Commands

```
pinpoint | pinpoint help                 {status:"home", app, version, helper:{url, running}, plans:[summary], commands:[{name, usage, summary}], next_step}
pinpoint example [plan|steps|answer|block]  the fixture JSON for that shape
pinpoint open <plan.json|-> [--no-open]  validate → ensure helper → PUT → open browser
                                         → {status:"opened"|"replaced", plan_id, url, revision, block_ids, dropped_messages, next_step}
pinpoint poll <plan-id> [--timeout-ms N] → {status:"messages"|"done"|"waiting"|"browser_closed", plan_id, messages, next_step, page:{url, revision, presence, pollers, block_ids}}
pinpoint answer <plan-id> --question <mid> (--text "…" | --file <p>|-) [--diagram <graph.json>]  → receipt
pinpoint append-steps <plan-id> <option-id> --file <steps.json>|-                               → receipt
pinpoint patch-block <plan-id> <block-id> --file <block.json>|-                                  → receipt
pinpoint show <plan-id> [--block <id>]   current stored plan or block JSON
pinpoint ack <plan-id> <message-id>...   → receipt
pinpoint status <plan-id>                → {status:"status", plan_id, url, revision, presence, pending_messages, block_ids, next_step}
pinpoint serve [--port N] [--state-dir D] [--idle-ms N]   foreground helper
pinpoint stop                            → {status:"stopped"}
pinpoint skill [--check | --install | --out <path>]        generate / verify / install the Claude Code skill
```

Receipt: `{status:"patched"|"answered"|"steps-appended"|"acked", plan_id, touched, revision, untouched_unchanged:true, acked, pending, next_step}`.

Errors: `{status:"error", code, message, issues?, next_step}` with codes `BAD_ARGS | INVALID_INPUT |
NOT_FOUND | NOT_AN_OPTION | STEPS_EXIST | ALREADY_ANSWERED | BLOCK_FULL | THREAD_BUSY | HANDED_BACK |
RECOMMENDED_LOCKED | KIND_MISMATCH | SERVER_UNREACHABLE | POLL_INTERRUPTED | INVARIANT_VIOLATION | IO`.

### Poll message shape

```json
{"id":"m-7","kind":"ask","block_id":"opt-b","block_label":"Way B · Refresh in the fetch wrapper","thread_id":"m-7","thread":[],"text":"why does this arrow go backwards?","excerpt":"retry once","at":"2026-10-03T18:02:11.000Z"}
{"id":"m-8","kind":"choose","block_id":"opt-a","option_id":"opt-a","text":"","at":"…"}
{"id":"m-10","kind":"ask","block_id":"opt-b","block_label":"…","thread_id":"m-7","thread":[{"question":"why does this arrow go backwards?","excerpt":"retry once","answer":"It retries once…"}],"text":"and on a 401?","at":"…"}
{"id":"m-11","kind":"done","text":"","at":"…"}
```

Every ask carries `thread_id` and `thread`: the earlier answered exchanges of that thread
(`question`, `excerpt?`, `answer` markdown) in ask order, empty for a fresh question. `choose` and
`done` carry neither key.

Status rules: a pending `done` → `done`; else any pending → `messages`; cap reached → `waiting`;
browser grace expired while polling → `browser_closed`.

### next_step templates (`src/core/output.ts`)

- `POLL_TAIL` = "Then run `<inv> poll <id>` as a background Bash command (run_in_background: true,
  timeout: 7200000); Claude Code re-invokes you when it exits. Never use nohup, &, or disown. If it is
  killed, run it again: messages stay queued until you answer or ack them."
- opened: "Do not respond to the user yet. The plan is open at <url>. " + POLL_TAIL
- messages: "Do not respond to the user yet. Handle each message in order, changing nothing but the
  block named:" then one line per message. An ask with an empty `thread` starts a subagent: "- m-7
  (Way B): start a Sonnet subagent for thread m-7 (Agent tool, model sonnet). Give it the question,
  the excerpt and `<inv> show <id> --block opt-b`. It returns the answer markdown (≤600 chars) and
  optionally a graph." A follow-up goes back to that subagent: "- m-10 (Way B): send it to thread
  m-7's subagent with SendMessage. If that subagent is gone, start one with `thread`." Both end "Then
  run `<inv> answer <id> --question <mid> --file <answer.json>`. If you cannot start subagents, answer
  it yourself." choose: "- m-8: write the concrete steps for option opt-a (`<inv> example steps` for the
  shape) and run `<inv> append-steps <id> opt-a --file <steps.json>`". When `page.pollers > 1`:
  "Another poll is attached to this plan; coordinate before answering." When any ask is present:
  "Start every subagent above in one message and wait for all of them; poll only after every answer
  is written.", because a poll re-delivers every unanswered message. Then POLL_TAIL.
- done: "The user finished reviewing. Stop polling and continue in the conversation. Chosen: Way A.
  Unanswered questions: m-7 (Way B: 'why …')." (the server already acked everything)
- waiting: "Nothing arrived within the wait cap; nothing was lost. " + POLL_TAIL
- browser_closed: "The browser tab was closed. Do not poll again on your own: tell the user the plan
  is still at <url> and ask whether to keep waiting."
- receipt: pending > 0 → "<n> message(s) still pending; run `<inv> poll <id>` now (it returns
  immediately)." else "Do not respond to the user yet. " + POLL_TAIL
- error INVALID_INPUT: "Fix these and retry: <up to 3 'path: message'>. `<inv> example plan` prints a
  valid shape."; SERVER_UNREACHABLE / POLL_INTERRUPTED: "Run the same command again; nothing was lost.
  If it keeps failing, read <stateDir>/helper.log or run `<inv> serve` in another terminal."

Block labels are interpolated with newlines and backticks stripped so a message can never break the
one-line-per-message format.

### HTTP (Hono on 127.0.0.1:<port>)

```
GET  /health                                   {ok, app:"pinpoint", version, startedAt, stateDir, plans:[summary], busy}
GET  /                                         home HTML
GET  /plans/:id                                page HTML
GET  /fonts/:file                              woff2 from the allowlist (404 otherwise)
GET  /api/plans                                {plans:[summary]}
PUT  /api/plans/:id                            PlanInput (id must match) → 201 created | 200 replaced {plan_id, url, revision, block_ids, dropped_messages}
GET  /api/plans/:id                            PlanState
GET  /api/plans/:id/blocks/:blockId            block JSON
GET  /api/plans/:id/blocks/:blockId.html       exactly renderBlock(block)
PUT  /api/plans/:id/blocks/:blockId            BlockInput → receipt
POST /api/plans/:id/answers                    AnswerInput → receipt
POST /api/plans/:id/steps                      StepsInput → receipt
POST /api/plans/:id/messages                   BrowserMessage → {message, block?:{blockId, rev, html}, revision, duplicate}
POST /api/plans/:id/acks                       {ids} → receipt
GET  /api/plans/:id/poll?timeoutMs=N           long-poll
GET  /api/plans/:id/events?since=R             SSE
POST /api/shutdown                             {ok:true} then stop
```

Guards (`src/server/guard.ts`): the URL hostname must be `127.0.0.1`, `localhost` or `[::1]`
(Bun derives it from the Host header on a socket; `app.request` yields `localhost`), else 403.
Mutating routes also reject a present `Origin` whose hostname is not loopback (CSRF from a web page),
and bodies over 1 MB (413). Error bodies: `{code, message, issues?}`; 400 for `INVALID_INPUT`,
`NOT_AN_OPTION`, `KIND_MISMATCH`, `RECOMMENDED_LOCKED`; 404 `NOT_FOUND`; 409 `STEPS_EXIST`,
`ALREADY_ANSWERED`, `BLOCK_FULL`, `THREAD_BUSY` ("Wait for the answer before replying."), `HANDED_BACK`; 500 `INVARIANT_VIOLATION`, `IO`.

### Poll handler

1. `pending = pendingMessages(state)`. If non-empty: `markDelivered` (and, when a `done` is among
   them, `ackMessages(all)`), save, broadcast `block` frames for touched blocks and a `presence`
   frame, respond with plain JSON.
2. `timeoutMs = clamp(query, 0, pollMaxWaitMs)`; `0` → `{status:"waiting"}` now.
3. Otherwise `polls.listen(planId, timeoutMs, signal, finish)`: a streaming 200
   `application/json` with header `Pinpoint-Poll-State: listening`, body `' '` immediately and every
   `heartbeatMs`, then one JSON document on wake (re-run step 1), timeout (`waiting`) or browser
   grace (`browser_closed`). Abort cleans up silently. The CLI reads it with `res.json()`;
   `JSON.parse` ignores leading whitespace.
4. Wake sources: `POST /messages` after `store.apply` has saved (persist-before-wake is call order,
   pinned by a test that records `['save', 'wake']`), and the browser grace timer.
5. Browser grace: when a poll attaches and `sse.clients(planId) === 0`, or when the last SSE client
   disconnects while `polls.waiters(planId) > 0`, arm `KeyedTimer(planId, browserGraceMs)`; an SSE
   connect cancels it; expiry wakes every poller with `browser_closed`.

### SSE (`GET /api/plans/:id/events?since=R`)

Frames `event:` / `data:` terminated by `\n\n`; a `: hb` comment every `heartbeatMs`. On connect:
`hello {revision, presence, review}`, then one `block` frame per block with `touchedAt > R` in plan
order (`appended` with `after` for blocks that did not exist at `R`), then live frames:

```
event: block      data: {"blockId":"opt-b","rev":3,"html":"<section …>…</section>","revision":13}
event: appended   data: {"blockId":"steps-opt-a","after":"verdict","rev":1,"html":"…","revision":14}
event: presence   data: {"presence":"working","undelivered":0}
event: plan       data: {"revision":15}        → the client reloads (plan replaced)
```

The page embeds `revision` in its boot JSON and connects with `?since=<revision>`. Reconnects reuse
the same URL, so a reconnect replays every block touched since boot; the client's `shouldApply`
(`incoming.rev > current data-rev`) makes replay idempotent. There is no event log and no
`Last-Event-ID` handling.

### Durability

One file per plan, `<stateDir>/plans/<id>.json`, rewritten whole on every transition with
`writeFileSync(tmp)` + `renameSync(tmp, final)`. Loaded once at boot; a file that fails to parse is
renamed to `<id>.json.corrupt-<iso>` and skipped, never fatal. `schemaVersion` is checked on load,
and an exchange or ask saved without a `threadId` loads as its own thread (`threadId = id`). A write
failure surfaces as 500 `IO` and the in-memory state is rolled back.

## 6. Browser UX

One document, no iframe, no side panel. Visual language from `plans-you-can-point-at.html`: the
`:root` tokens (`--ground --surface --sunken --ink --muted --faint --line --accent --accent-soft
--hold --hold-soft --shadow`), dark overrides under `@media (prefers-color-scheme: dark)` guarded by
`:root:not([data-theme="light"])` and `:root[data-theme="dark"]`, `color-scheme: light dark`.
Source Serif 4 for prose, IBM Plex Sans for structure, IBM Plex Mono for paths; hairlines, 6 px radii,
caps-tracked 12 px eyebrows in accent, 40 px stage gaps. Accent is "the plan talking"; `--hold` orange
is "the held line" (questions, waiting, agent working).

- **Header** (sticky): eyebrow `PINPOINT`, plan title, task sentence; right: presence chip
  (`data-testid=presence`, `data-state`), "Done reviewing" (`data-action=done`,
  `data-testid=done`), theme toggle (`data-testid=theme-toggle`).
- **Stages**: `01 · What's already here` (findings block: optional codebase-map diagram, legend,
  rows `path · ROLE · note`), `02 · Three ways` (titled `Two ways`, `Three ways` or `Four ways` by
  the option count; option tabs above the cards, one card visible at a time, see **Option tabs**),
  `03 · The pick` (verdict callout: 3 px accent left border, "Pick B" chip, the why), `04 · Steps`
  (hidden until the first steps block; `repeat(auto-fit, minmax(320px, 1fr))` grid so a second
  chosen option lands beside the first).
- **Option card**: letter badge, name, pattern tag ("what engineers call it"), diagram (reused
  nodes filled `--accent-soft`, new dashed `--hold`, changed `--accent` stroke, external `--faint`),
  reuses as mono chips, cost row (effort pips 1–3 and a risk pip, both `aria-hidden`, then the words
  `<span class="cost-label" data-testid="cost-<id>">Medium effort · Low risk</span>` with S/M/L read
  as Small/Medium/Large, then the sentence), footer "Choose this way"
  (`data-action=choose`, `data-testid=choose-<id>`). Recommended card: 2 px accent border,
  `RECOMMENDED` ribbon, why line. Server-rendered states: `requested` → button disabled, "Steps
  requested · waiting for the agent"; `ready` → "Steps ready ↓" link to the steps block.
- **Option tabs**: `<div class="option-tabs" role="tablist">` above `.options`, one
  `<button role="tab" data-testid="tab-<id>" aria-controls="block-<id>">` per option labelled
  `<letter> · <name>` (full label in `title`, long names truncate with an ellipsis), a ★ on the
  recommended tab. Visibility lives in `<style id="option-tab-style">` holding one rule,
  `.options > .block--option:not([data-block="<shown id>"]){display:none}`, so a live block swap
  never changes which card shows. The server renders it for the recommended option; the client
  (`tabs.ts`) rewrites it on a tab click and follows the WAI-ARIA tabs pattern (roving `tabindex`,
  ArrowLeft/ArrowRight wrap, Home/End). The toast's Jump switches to a hidden option's tab first, and an
  answer on a hidden option counts as out of view. Active tab: 2 px `--accent` underline, ink text;
  inactive `--muted`; 44 px tap target. At 390 px the tab row scrolls inside itself, never the page.
- **Block contract**: `<section class="block" data-block="opt-b" data-kind="option" data-rev="3"
  data-label="Way B · …" tabindex="0" data-testid="block-opt-b">` with a server-rendered Ask button
  (`data-action=ask`, `data-testid=ask-opt-b`, opacity 0 → 1 on hover/focus/selected, always in the
  DOM so hover mutates nothing) and a `.qa` slot. The only client-side mutations inside a block are
  `data-selected`, the `is-updated` class and, after hand-back, `disabled` on Reply buttons.
- **Pointing**: click anywhere in a block that is not inside `[data-action], a, button, textarea,
  input`, or press Enter on a focused block → `data-selected`, 2 px accent outline, and the composer
  docks beneath it. One selection at a time; Esc deselects.
- **Composer** (`#composer`, `data-testid=composer`): one element positioned inside `.page` under
  the selected block (`top = offsetTop + offsetHeight + 10`, repositioned on resize and after a
  block swap), outside every block's DOM so a swap cannot destroy it. Heading `ASK ABOUT <label>`
  plus the excerpt when one was captured; textarea (`data-testid=composer-input`); hint "Enter to
  send · Shift+Enter for a new line · Esc to close"; Send (`data-testid=composer-send`). Enter sends
  (`isComposing` guarded), Shift+Enter newline, Esc closes only when empty. Drafts persist per
  plan+block in sessionStorage (try/catch).
- **Excerpt**: on send, `excerpt` = the non-collapsed selection text inside the block, or the
  `data-node-label` of a clicked diagram node, ≤ 200 chars. Shown in the composer heading, the
  question pill and the poll message.
- **Pending → answer, in place**: the POST response carries the re-rendered block; the client swaps
  it (`template.innerHTML = html; el.replaceWith(…)`) and re-applies `data-selected`. The `.qa` slot
  shows a hold-dashed pill "You asked: … · Asked" then "· Delivered to the agent" (both
  server-rendered). When the answer lands, the SSE `block` frame swaps the same block: the pill settles
  into a solid card with the rendered markdown and optional small diagram; `is-updated` plays a 900 ms
  accent-soft sweep. If the block is off-screen, a toast (`data-testid=toast`) "Answer attached to
  Way B · Jump" appears for 6 s. Nothing else on the page re-renders or loses scroll position.
- **Threads**: the `.qa` slot groups exchanges into `.thread` divs (`data-testid=thread-<thread>`)
  in first-ask order; every exchange after a thread's first carries `exchange--followup`. A thread
  whose last exchange is answered ends with a server-rendered Reply button (`data-action=reply`,
  `data-testid=reply-<thread>`). Reply opens the composer under that thread with heading
  `REPLY · <label>`, a draft keyed `<block>:<thread>`, and posts the ask with `threadId`. A 409
  `THREAD_BUSY` keeps the text and shows the server's message as the hint. Hand-back disables every
  Reply button.
- **Choose**: posts `choose`; the card re-renders `requested`; when `append-steps` lands, the
  `appended` frame inserts the steps block (stage 04 fades in on first use), the card re-renders
  `ready`. A second choice appends another column.
- **Presence chip**: `waiting` grey dot + "Agent not on the line" (+ "· 2 waiting"); `listening`
  accent dot with slow pulse; `working` hold dot with spinner; `handed-back` "Handed back to the
  agent" with the composer disabled. Labels come from `src/core/presence.ts`.
- **Motion**: pulse, spinner, the sweep and the composer's 180 ms entrance only; all removed under
  `prefers-reduced-motion`. `:focus-visible` is a 2 px accent ring everywhere.
- **Phone width**: 16 px gutters, single column, diagrams scroll inside their figure, no page-level
  horizontal scroll (asserted at 390 px).

## 7. Agent skill

`skills/pinpoint/SKILL.md` is generated by `src/cli/skill.ts` from `COMMANDS` and the output
templates with the placeholder invocation `pinpoint`; `pinpoint skill --check` fails when the
committed copy drifts. `pinpoint skill --install` writes `~/.claude/skills/pinpoint/SKILL.md` with the
absolute invocation (`<bun path> <repo>/bin/pinpoint.ts`) baked into the body and into
`allowed-tools: Bash(<that prefix>:*)`, so Claude Code never prompts for the poll. Hard cap 6000
characters (`SKILL_MAX_CHARS`); frontmatter keys `name`, `description`, `allowed-tools` only.

Body (numbered, imperative):

1. **When**: the user asks for a plan, design or approach and more than one way exists. Do not write
   a text plan; use Pinpoint.
2. **Look first**: read the codebase before proposing anything; collect `reuse`, `touch` and
   `context` files with one-line notes. Never propose building what a `reuse` item already does.
3. **Draw the real ways, two to four; never pad to reach a count.** Each option has a diagram of
   ≤ 8 nodes with statuses, the pattern name, what it reuses, a cost, and exactly one
   `recommended: true` with a one-line `why`. A diagram carries the structure; a sentence explains it.
   The rule carries the plan shape itself, so drawing a plan costs no `example plan` call:
   `{id, title, task, findings:{summary, items:[{path, role, note}], diagram?}, options:[{id, name,
   pattern, diagram:{nodes, edges}, reuses, cost:{effort, risk, note}, recommended, why?}]}` with the
   enums spelled out. A skill test checks that every key in the plan schemas appears in this shape.
4. **Open**: write the JSON to your scratch directory (never into the user's repo) and run
   `<inv> open <file>`. On `error`, fix per `issues` and rerun.
5. **Stay on the line**: run the poll exactly as `next_step` prints it, as a background Bash
   command (`run_in_background: true`, `timeout: 7200000`). Do not talk to the user while it runs.
6. **When it exits, read stdout completely and follow `next_step` literally.**
7. **Rules**: change only the block named; use `show --block` before `patch-block`; one poll at a
   time; each question thread gets its own Sonnet subagent and follow-ups go to the same one; you are
   the only writer (subagents return the answer, you run `answer`); wait for this poll's subagents
   and write their answers before polling again; stdout JSON is the contract; `help` and `next_step`
   are authoritative.

## 8. Testing strategy

### Levels

| Level | Proves | Tool | Command |
|---|---|---|---|
| L0 static | types, style | `tsc --noEmit`, `biome check` | `bun run typecheck && bun run check` |
| L1 unit | every pure module | `bun test` | `bun run test:unit` (`test/unit`) |
| L2 http in-process | every route, receipts, poll, SSE, guards, grace | `app.request` via `test/helpers/test-app.ts`, memory persistence, 5 ms timers, `STUB_ASSETS` | `bun run test:http` (`test/http`) |
| L3 socket | heartbeat bytes on TCP, real abort, idle shutdown, serve options | `startServer({ port: 0 })` + `fetch` | `test/http/socket.test.ts` |
| L4 cli in-process | every subcommand's stdout JSON and exit code | `run(argv, fakeIo)` with `fetch: (u, i) => app.request(u, i)` | `bun run test:cli` (`test/cli/run.test.ts`) |
| L5 subprocess + daemon | real process stdout is one JSON document; the detached spawn path | `Bun.spawn`, `node:child_process` | `test/cli/subprocess.test.ts`, `bun run test:daemon` |
| L6 browser | DOM glue, byte-identity, keyboard, offline, visual | `@playwright/test` against `pinpoint serve` on port 4790 | `bun run test:e2e` (`test/e2e/*.e2e.ts`) |

`bun test` runs L1–L5 with no network and no browser; `bunfig.toml` sets `[test] timeout = 10000`
and a coverage threshold (lines and functions 0.9, `src/client/**` and `scripts/**` excluded because
the browser covers them). Playwright specs end in `.e2e.ts` so `bun test` never collects them. `bun
run verify` = check, typecheck, `bun test --coverage`, `skill --check`, e2e; `test/unit/package.test.ts`
pins the `verify` command list and the dependency list.

### Rules that keep it deterministic

- No fake timers: every timer is a constructor knob (`heartbeatMs`, `pollMaxWaitMs`,
  `browserGraceMs`, `idleTimeoutMs`); tests pass 5–50 ms.
- No `setTimeout(n)` for sequencing. Readiness is observed: `app.request` resolves when the
  handler returns the streaming response, which is after the waiter is armed; `waitFor(() =>
  polls.waiters(id) === 1)` ticks every 1 ms with a 1 s deadline and throws with the predicate text.
- Every awaited read is wrapped in `AbortSignal.timeout(2000)`; every stream is cancelled and every
  server closed in `afterAll`.
- Heartbeat bytes coalesce: read until ≥ 3 bytes, never one read per tick.
- Clock and ids are injected (`fixedClock()`), so no snapshot contains randomness. A grep test
  bans `Date.now(`, `new Date(` and `Math.random(` under `src/core`.
- `bun test` runs files in one process: no `mock.module`; dependency injection only.
- At most one snapshot per block kind; behaviour assertions are explicit `toContain` checks.

### The long-poll cases (`test/http/poll.test.ts`)

1. drain: `?timeoutMs=0` → `waiting`, `messages: []`
2. wake without sleeps: request with `timeoutMs=5000` → header `listening`, `waiters === 1`; POST a
   message; `await res.json()` → `messages` with that id; `waiters === 0`
3. heartbeat bytes (L3): read ≥ 3 whitespace bytes, wake, remaining body parses; only whitespace
   precedes the JSON
4. timeout: `timeoutMs=20` → `waiting`, waiters 0
5. abort: `AbortController` → waiters 0, no leaked timer
6. durability without restore: deliver, do not ack, poll again → same ids; a new `PlanStore` over the
   same persistence still has them pending
7. persist-before-wake: recording persistence logs `['save', 'wake']`
8. two pollers: both resolve with the same message; `page.pollers` was 2
9. done: `done` → status `done`, everything acked, next poll `waiting`; unanswered ids listed
10. browser grace: poll with no SSE client → `browser_closed` after `browserGraceMs`; SSE connect
    inside the grace cancels it

### Functionality → test matrix

| Functionality | L1 | L2 / L3 | L4 / L5 | L6 |
|---|---|---|---|---|
| Plan validation (2–4 options, 1 recommended, ids, nodes, caps) | schema | plans (400 issues) | run (INVALID_INPUT, exit 1) | — |
| Look-first findings block | render-blocks | plans (page has findings) | — | renders |
| Three diagrams, one recommended, verdict | layout, svg, render-blocks | blocks.html = renderBlock | — | renders (3 svg, 1 ribbon, verdict) |
| Option tabs (one card shown, tab switch, keys, live swap keeps the tab, Jump switches tab), cost words | render-page, render-blocks | — | — | renders, tabs, toast |
| Point and ask (message, pill, excerpt) | state | messages (pill html, dedupe, 404) | — | ask, keyboard-excerpt |
| Threads (fresh ask starts one, reply joins it, `THREAD_BUSY`, `threadId` only on ask, load backfill) | state, schema, persistence | messages (409 `THREAD_BUSY`) | — | threads |
| Thread grouping, follow-up styling, Reply button, reply composer, disabled after hand-back | render-blocks | — | — | threads |
| Thread history in the poll, subagent routing in `next_step` and the skill | output, skill | — | — | demo-agent (follow-up cites the thread length) |
| Answer attached to that block only | state (`toBe`), hash | receipts (hash before == after, other block html byte-equal) | run (receipt) | live-patch (outerHTML of every other block identical) |
| Choose → steps appended, side by side | state | steps (appended.after, 409) | run | choose |
| Patch a block, verdict re-derived | state | receipts | run (show + patch-block) | — |
| Long-poll (10 cases) | poll-hub, stream, output | poll, socket | run (poll wake through `run()`), subprocess | demo-agent |
| Durability (persist before wake, atomic file, restart) | persistence, store | poll #6, #7 | — | reload |
| Live updates (hello, replay by touchedAt, frames) | sse-hub, frames | events | — | live-patch, choose |
| Presence chip and hand-back | presence | events, poll #9 | status | presence-done |
| Browser grace | timers | poll #10 | — | — |
| Idle shutdown, shutdown route, `idleTimeout: 0` | timers, start (serveOptions) | socket | daemon | — |
| Helper discovery / detached spawn | ensure-server, daemon | — | spawn | — |
| CLI contract (one JSON doc, key order, next_step names real commands, invocation prefix) | output, commands | — | run, subprocess | — |
| Fetch failure mid-poll | api | — | run (rejecting fetch → POLL_INTERRUPTED) | — |
| Skill generate / check / install | skill | — | run (`skill --install --out`) | — |
| Security (hostname, Origin, body limit, markdown XSS, jsonScript) | markdown, esc, guard | guard | — | — |
| Fonts offline | assets | fonts route | — | offline (no request leaves 127.0.0.1) |
| Theme, drafts, reload | — | — | — | theme, drafts, reload |
| Keyboard-only ask | client pure fns | — | — | keyboard-excerpt |
| Visual baseline | — | — | — | visual (1280 light/dark, 390 light) |
| Top to bottom (browser → helper → real CLI → helper → browser) | — | — | — | demo-agent |

### E2E specs (`test/e2e`, workers 1, each seeds its own plan id via `request.put`)

`renders`, `live-patch`, `ask`, `keyboard-excerpt`, `drafts`, `choose`, `presence-done`, `toast`,
`theme`, `reload`, `offline`, `visual`, `threads`, `demo-agent`. The webServer is `bun src/cli.ts serve
--port 4790 --state-dir .e2e-state` with `PINPOINT_NO_OPEN=1`, `url: /health`,
`reuseExistingServer: !process.env.CI`. `scripts/demo-agent.ts` is the agent side of `demo-agent`:
it loops `poll --timeout-ms` through the real CLI subprocess and answers asks and chooses with
canned fixtures, and it is also the hackathon demo driver when Claude is not on the line. A follow-up's
canned answer starts "Follow-up <n+1> in this thread:" with n = `thread.length`, so the spec proves
the history crossed the real CLI.

## 9. Out of scope for the MVP

Takeover between pollers, remote access, attachments, text-range anchors beyond the excerpt, a
Mermaid block kind, export page, telemetry, multi-user. A `kind: 'mermaid'` diagram can be added later
behind the same `diagram` field using a validator worker without touching other modules.
