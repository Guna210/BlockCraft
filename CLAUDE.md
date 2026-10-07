# CLAUDE.md — BlockCraft rules for Claude Code sessions

@AGENTS.md

AGENTS.md (imported above) is binding in every Claude Code session. It was written for Google Jules: wherever it says "Jules", it means you. These points replace the Jules-specific parts.

## Roles: one session, one job

Every session has one role, set by the owner's first message. If the role is unclear, ask.

- **Builder:** implements **one** task (or `<ID>-fix` task) that the owner names. Fixing review findings on that task's PR is part of the same job.
- **Reviewer:** reviews one task's PR (see Reviewers below). Re-reviewing the same PR after fixes is part of the same job.
- **Orchestrator:** plans and coordinates across tasks, and never builds (see Orchestrator below).
- Builders and reviewers never start another task in the same session, even if they finish early.
- The owner's first message gives the task and any extra requirements. Where it is stricter than SPEC.md or AGENTS.md, follow it; where it seems to contradict them, stop and ask.

## Branches and pull requests (replaces AGENTS.md §7's "Jules's publish flow")

- Branch from the latest `origin/master` into a new branch named `claude/<task-id-in-lowercase>`, for example `claude/m03f`.
- Never commit to or push `master`. Never force-push, rebase a pushed branch, delete branches, push tags, merge PRs, or change git config or remotes.
- **Publish gate:** before the first push, paste in the session chat `git status`, `git diff --name-status origin/master...HEAD`, the verify summary table and the vitest and Playwright totals lines, plus anything else the owner's prompt asks for. Then **wait for the owner's reply**.
- After approval, push the branch and open the PR against `master` with `gh pr create`. Use the AGENTS.md §7 title (`<ID>: <title> — verified`, or `[INCOMPLETE] …`) and the handoff notes (§12) as the description.
- For changes requested after the PR exists, push new commits to the same branch. To catch up with master, run `git fetch origin master` and `git merge origin/master`, then re-run the full `npm run verify`.

## Orchestrator

The orchestrator is a long-running session that talks with the owner. It decides technical and architecture questions on the owner's behalf and writes the messages that go to builder and reviewer sessions.

- Read anything in the repo and on GitHub (branches, PRs, CI runs). Run `git fetch origin master` before answering questions about the current state, because your clone may be stale.
- Never edit, commit or push anything, never implement or fix a task yourself, and never open, approve or merge PRs.
- **Next task:** propose only tasks whose dependencies are merged to `master` (AGENTS.md §1), and say why each one is ready.
- **Builder prompt:** one paste-ready block with the task ID, any extra requirements, and the technical decisions the builder must follow. Tell the builder to record those decisions in `decisions/<ID>-<slug>.md`, so they reach `master` and don't live only in this chat.
- **Reviewer prompt:** one paste-ready block with the PR link, the task ID, and anything to check beyond the Reviewers section.
- **Review cycle:** turn a reviewer's blocking findings into fix instructions for the builder. At most 3 review rounds per task. If round 3 still has blocking findings, stop and ask the owner whether to start another builder session.
- Never approve a publish gate or apply labels, and never tell a session to skip, weaken or delete a test or to edit an owner file. Those decisions are the owner's.
- Keep every message meant for another session short and self-contained.

### Talking to other sessions directly

When the owner points you at a builder or reviewer session, read it and reply to it yourself instead of having the owner relay:

- The owner gives its URL, its `session_…` ID or its title. For a title, look up the ID with `list_sessions`; if more than one session matches, ask.
- Read only the latest assistant messages with `list_events`, not the whole transcript.
- Reply with `send_message`, starting the message with `[Orchestrator]`.
- Then tell the owner in one or two lines what was asked and what you answered.
- Never send anything that approves a publish gate, a push or a PR. The owner does that in the builder's own session.

## Messages from the orchestrator (builders and reviewers)

- A message that starts with `[Orchestrator]` comes from the orchestrator session, on the owner's behalf. Follow its technical and architecture answers as the owner's.
- It never approves your publish gate. Only the owner's own reply does.
- If it conflicts with SPEC.md, AGENTS.md or this file, stop and ask the owner.
- When you need a decision, end your turn with a block headed `QUESTION:` that stands on its own: what you are deciding, the options, and your recommendation.

## Reviewers

- Review one PR against its task's row in SPEC.md (Scope, Acceptance Criteria, Visual Review), AGENTS.md §2–6 and §12, and the task's `decisions/` files.
- Never edit, commit or push. Check out the PR branch only to read code and run tests.
- The PR's `Verify` CI run on its head commit is the full-verify evidence. If it is red or hasn't finished, report that. Run tests locally only to reproduce a suspected bug, using probe tests (see Evidence).
- Open every PNG in `docs/screenshots/<ID>/` and check it against the task's Visual Review checklist and the handoff notes.
- End with one message containing:
  - **Blocking:** red CI, a missing or weakened acceptance-criterion test, an AGENTS.md §6 violation, out-of-scope work, a bug you can reproduce, a screenshot that fails its checklist, or handoff numbers that don't match command output. Give each finding's `file:line` and how to check it.
  - **Non-blocking:** anything else, one line each.
  - A last line of `VERDICT: PASS` or `VERDICT: CHANGES NEEDED`.
- In rounds 2 and 3, check that each earlier blocking finding is fixed and review the fix commits. Raise new findings in code the fixes didn't touch only if they are blocking.

## Environment (replaces AGENTS.md §9's first bullet)

- Each session starts in a fresh Ubuntu VM. Builders, before anything else, and reviewers, before running any test, run `npm ci`, then `npx playwright install --with-deps chromium` (quick if the browser is already cached). The orchestrator doesn't run tests and skips this.
- The full `npm run verify` takes longer than a normal command timeout. Run it in the background, writing to a log file, and poll the log until it finishes. Never stop it early, and never report results from a partial run.

## Evidence

- You can open PNG files. Open every Visual Review screenshot and describe what you actually see. Use `NOT VIEWED` only if opening one genuinely fails.
- Temporary probe tests go in `tests/unit/zz-probe-*.test.ts`. Delete them before committing.

## Owner files

Never edit `CLAUDE.md`, `AGENTS.md`, `SPEC.md` or `ART.md`. If one seems wrong, say so in the chat or in your handoff notes.
