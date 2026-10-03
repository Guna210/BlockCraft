# CLAUDE.md — BlockCraft rules for Claude Code sessions

@AGENTS.md

AGENTS.md (imported above) is binding in every Claude Code session. It was written for Google Jules: wherever it says "Jules", it means you. These points replace the Jules-specific parts.

## One session, one job

- A session either implements **one** task (or `<ID>-fix` task) that the owner names, or does one review the owner asks for. Never start another task in the same session, even if you finish early.
- The owner's first message gives the task and any extra requirements. Where it is stricter than SPEC.md or AGENTS.md, follow it; where it seems to contradict them, stop and ask.

## Branches and pull requests (replaces AGENTS.md §7's "Jules's publish flow")

- Branch from the latest `origin/master` into a new branch named `claude/<task-id-in-lowercase>`, for example `claude/m03f`.
- Never commit to or push `master`. Never force-push, rebase a pushed branch, delete branches, push tags, merge PRs, or change git config or remotes.
- **Publish gate:** before the first push, paste in the session chat `git status`, `git diff --name-status origin/master...HEAD`, the verify summary table and the vitest and Playwright totals lines, plus anything else the owner's prompt asks for. Then **wait for the owner's reply**.
- After approval, push the branch and open the PR against `master` with `gh pr create`. Use the AGENTS.md §7 title (`<ID>: <title> — verified`, or `[INCOMPLETE] …`) and the handoff notes (§12) as the description.
- For changes requested after the PR exists, push new commits to the same branch. To catch up with master, run `git fetch origin master` and `git merge origin/master`, then re-run the full `npm run verify`.

## Environment (replaces AGENTS.md §9's first bullet)

- Each session starts in a fresh Ubuntu VM. Before anything else, run `npm ci`, then `npx playwright install --with-deps chromium` (quick if the browser is already cached).
- The full `npm run verify` takes longer than a normal command timeout. Run it in the background, writing to a log file, and poll the log until it finishes. Never stop it early, and never report results from a partial run.

## Evidence

- You can open PNG files. Open every Visual Review screenshot and describe what you actually see. Use `NOT VIEWED` only if opening one genuinely fails.
- Temporary probe tests go in `tests/unit/zz-probe-*.test.ts`. Delete them before committing.

## Owner files

Never edit `CLAUDE.md`, `AGENTS.md`, `SPEC.md` or `ART.md`. If one seems wrong, say so in the chat or in your handoff notes.
