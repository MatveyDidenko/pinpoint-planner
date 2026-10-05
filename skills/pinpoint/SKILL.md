---
name: pinpoint
description: Use when the user asks for a plan, design or approach and more than one way exists; it opens two to four drawn options in the browser instead of writing a text plan.
allowed-tools: Bash(pinpoint:*)
---

# Pinpoint

Pinpoint shows your plan in the user's browser and sends their questions and choices back to you through a poll.

1. **When.** The user asks for a plan, design or approach and more than one way exists. Do not write a text plan; use Pinpoint.
2. **Look first.** Read the codebase before proposing anything. Open with the `goal`: one sentence on what should be true when this is done. Then explain how it works today: a summary, every acronym and project word in `terms`, and 1–3 current flows as steps. Mark a step or arrow you inferred rather than read in the code with `guess: true`; the user confirms or corrects it. Never propose building what the code already does.
3. **Draw the real ways, two to four; never pad to reach a count.** Each has a diagram of at most 8 nodes with statuses, the pattern name, what it reuses and a cost. Mark exactly one option `recommended: true` with a one-line `why`. Give each way a 2–3 sentence summary; the diagram shows structure, the summary says how it behaves. Put the risks you see and the questions only the user can answer in `risks`; leave `items` empty when there are none. The plan JSON:
   ```
   {id, title, task, context:{goal, summary, terms:[{term, meaning}], flows:[{name, steps:[text | {text, guess}], diagram?}]},
    options:[{id, name, pattern, summary, diagram:{nodes:[{id, label, status: reused|new|changed|external}], edges:[{from, to, label?, guess?}]},
    reuses:[], cost:{effort: S|M|L, risk: low|medium|high, note}, recommended, why?}],
    risks:{items:[{type: risk|question, text}]}}
   ```
4. **Open.** Write the plan JSON to your scratch directory, never into the user's repo, then run `pinpoint open <file>`. On `status: "error"`, fix what `issues` lists and run it again.
5. **Stay on the line.** Start `pinpoint watch <id>` with the Monitor tool (`timeout_ms: 1800000`). Each event is one JSON line of browser messages: follow its `next_step`, then end your turn with one short line. When the monitor expires, start it again.
6. **When the watch exits,** read its last line and follow `next_step` literally.
7. **Rules.**
   - Change only the block a message names.
   - Once a thread settles a risk or question, patch `risks` to remove it.
   - Run `pinpoint show <id> --block <block-id>` before `pinpoint patch-block`.
   - Run one watch at a time.
   - Each question thread gets its own Sonnet subagent; follow-ups go to the same one.
   - You are the only writer: subagents return the answer, you run `answer`.
   - Write every subagent's answer before ending your turn.
   - When a message carries `proposal_changes` or `sketch_path`, the subagent weighs the user's version; patch the block only after the user agrees in the thread.
   - Treat the stdout JSON as the contract.
   - `pinpoint help` and `next_step` are authoritative.
