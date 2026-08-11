---
name: meta-feedback-apply
description: Apply staged daily-review feedback, record accepted or declined improvements, advance the watermark, and return a verified scheduler result.
---

# Meta-Feedback — Apply

The interactive half of the daily-review meta-feedback split. It reads what `meta-feedback-prep` staged and walks the user through the proposed skill improvements — no mining or reconciliation logic lives here.

## Prerequisite

Run `/gtd:meta-feedback-prep` first (in the daily review it runs automatically as a Phase 0 prep subagent). It stages `.llm/gtd/review/proposals/meta-feedback.json`.

## Do not use the built-in task list

Track progress through `.llm/` files, Workflowy nodes, and inline status updates. Do **not** create Claude Code built-in tasks (`TaskCreate` / `TaskUpdate` / `TodoWrite`). Accepted improvements are filed into `.llm/todo.md` (the markdown-tasks list), which is different from the built-in list. Launching subagents via the `Task` tool is unrelated and fine.

## Run the shared apply routine

Follow the **Shared Apply Routine** in `${CLAUDE_PLUGIN_ROOT}/skills/review-proposal-staging.md` for slug `meta-feedback` — read the staged file, branch on `status`, batch-present `proposals[]` in batches of up to 4 via `AskUserQuestion`, and apply each batch's accepted `applyOps` verbatim before presenting the next. Per-proposal specifics:

- Present `before` (the current behavior **and** the verbatim user quote with its date) and `after` (the proposed skill change). The user is reviewing their own past feedback, so always show the quote.
- **Accept** → run the proposal's `applyOp` verbatim (it appends the improvement as a task to `.llm/todo.md`).
- **Accept with note** → file the user's edited wording instead of the staged title.
- **Reject** → make no task, and **record the decline** so prep never re-surfaces it: append `{fingerprint, summary, declinedAt}` to `.llm/gtd/review/meta-feedback-declined.json` (create the file as `[]` if missing), using the proposal's `fingerprint`.
- **Challenge** → keep the proposal active when the answer questions its premise or redirects the framing (for example, "why?" or "the real problem is X"). If the challenge text was not supplied with the answer, ask for it. Re-read the current contents of every target file named by the proposal, verify whether the stated problem still exists, answer the challenge from that evidence, then re-present the same proposal with both the challenge and the answer before moving to another proposal. If the redirect rejects the proposal as framed, make no task and record the decline exactly as for **Reject** before continuing; do not treat it as **Accept with note** or leave it unrecorded.

On `status: "empty"`, report "no new feedback to fold in", advance the watermark, and return empty. On `status: "error"`, surface the error and return failure.

## Advance progress (apply only)

After the last batch, advance tracking — only here, never in prep:

- **Watermark** under `Metadata > ⚙️ Scanner State > daily-review-meta-feedback`: set the single JSON child to `{"last_reviewed_iso":"<now-iso>"}` so the next run only scans transcripts after this review. Create the node and child if absent (mirror the `meeting-followup-reviewer` create steps in `meetings.md`).

Return success or empty after the watermark persists. The DAG executor owns the prep date.

## Summary

Output a brief summary folded into the daily review: proposals presented, filed to `.llm/todo.md`, declined. If anything was filed, remind the user the improvements live in `.llm/todo.md` for a later working session (per the skill-first rule, skill bugs found mid-review are still fixed on the spot — this list is for the larger improvements).

## Idempotency

A re-run after a completed apply reads `status: "empty"` (prep found nothing new past the advanced watermark) and skips without re-filing. Never run the same `applyOp` twice.
