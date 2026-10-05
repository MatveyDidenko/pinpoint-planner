---
name: pinpoint
description: Use when the user asks for a plan, design or approach and more than one way exists; it opens two to four drawn options in the browser instead of writing a text plan.
allowed-tools: Bash(pinpoint:*)
---

# Pinpoint

Pinpoint shows your plan in the user's browser and sends their questions and choices back to you through a poll.

1. **When.** The user asks for a plan, design or approach and more than one way exists. Do not write a text plan; use Pinpoint.
2. **Look first.** Read the codebase before proposing anything. Explain how it works today first: a summary, every acronym and project word in `terms`, and 1–3 current flows as steps. Never propose building what the code already does.
3. **Draw the real ways, two to four; never pad to reach a count.** Each has a diagram of at most 8 nodes with statuses, the pattern name, what it reuses and a cost. Mark exactly one option `recommended: true` with a one-line `why`. Give each way a 2–3 sentence summary; the diagram shows structure, the summary says how it behaves. The plan JSON:
   ```
   {id, title, task, context:{summary, terms:[{term, meaning}], flows:[{name, steps:[], diagram?}]},
    options:[{id, name, pattern, summary, diagram:{nodes:[{id, label, status: reused|new|changed|external}], edges:[{from, to, label?}]},
    reuses:[], cost:{effort: S|M|L, risk: low|medium|high, note}, recommended, why?}]}
   ```
4. **Open.** Write the plan JSON to your scratch directory, never into the user's repo, then run `pinpoint open <file>`. On `status: "error"`, fix what `issues` lists and run it again.
5. **Stay on the line.** Run the poll exactly as `next_step` prints it, as a background Bash command with `run_in_background: true` and `timeout: 7200000`. Never use nohup, &, or disown. Do not talk to the user while it runs.
6. **When it exits,** read stdout completely and follow `next_step` literally.
7. **Rules.**
   - Change only the block a message names.
   - Run `pinpoint show <id> --block <block-id>` before `pinpoint patch-block`.
   - Run one poll at a time.
   - Each question thread gets its own Sonnet subagent; follow-ups go to the same one.
   - You are the only writer: subagents return the answer, you run `answer`.
   - Wait for this poll's subagents and write their answers before polling again.
   - When a message carries `proposal_changes` or `sketch_path`, the subagent weighs the user's version; patch the block only after the user agrees in the thread.
   - Treat the stdout JSON as the contract.
   - `pinpoint help` and `next_step` are authoritative.
