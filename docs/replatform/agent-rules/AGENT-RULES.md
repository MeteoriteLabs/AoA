# M1 agent rules (read fully before starting)

You are working on the AoA re-platform, milestone M1, Step 0. The plan of record is
`docs/replatform/qa/2026-09-21-m1-execution-plan.md` on `origin/docs/replatform-program` (merged as `1cc7e2f`).
Read the section of the plan that names your unit, and the M1 sections of
`docs/replatform/epic-regrooming/scope-triage.md`.

## Branch and PR
- Create your OWN worktree and branch from the program tip. Do not work in any existing worktree:
  `git fetch origin docs/replatform-program` and then
  `git worktree add C:/<short> -b claude/m1-<unit> origin/docs/replatform-program`.
  Use a short path under C:/ such as C:/m1s3, because deep OneDrive paths hit MAX_PATH.
- Open ONE PR with base **`docs/replatform-program`**. NEVER target `main`. NEVER merge PR #323.
- **Do NOT merge your PR.** The planning session merges it. Your job ends when:
  1. Codex (`chatgpt-codex-connector`) has completed a review on your final head with no unresolved findings.
     Re-request with a PR comment `@codex review`. A "Failed" review status means it never ran, so re-request.
  2. `ci-required` is `pass`.
  Fix every Codex finding at source. First verify it is real by reading the code or doc. Reply on the
  thread, resolve it, and re-request review.
- Commit messages end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
  PR bodies end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- Use the `gh` CLI. There is no `jq` on PATH; use `gh --jq`.

## Evidence discipline (this programme's failure classes)
- **Verify at source.** Every claim about code, a guard, a run or a register must come from reading
  it, not from reasoning or memory. Cite code by SYMBOL (file + symbol), with a line only as a hint.
  Cite CI evidence by job, not only by run id.
- **Never rewrite history in a quote.** A line recording what an earlier version said, like
  "(was `X`)" or "Superseded text: …", keeps its old ids and wording.
- **A check that evaluates nothing is not a check.** Every new guard or test needs a positive
  control: show that it goes red when the thing it checks is broken.
- **Ids:** before minting any id, find the true max across the WHOLE repo (docs, scripts, server,
  packages). Test fixtures contain fake high ids such as `E0-F999` and `WRK-042`; those are not real.
  `check-register-id-uniqueness` catches collisions.
- **Immutable records:** files under `docs/replatform/epics/*/qa/`, `*/handoffs/` and
  `milestones/*/{qa,handoffs}/` are immutable once committed. Never edit an existing one.
- **Status `complete`** on a ticket may be set only by a DISTINCT reviewer, never by the author.

## Before EVERY push
Run the full guard set and require all of it green:
```
cd <your worktree>
fail=0; for g in $(grep -oE "node scripts/check-[a-z0-9-]+\.mjs" .github/workflows/pr.yml | sort -u | awk '{print $2}'); do case "$g" in *browser-suite-executed*|*embedded-secrets*|*schema-migration-drift*|*worker-protocol-package*|*verdict-consumer-freshness*|*evidence-immutability*) continue;; esac; node "$g" >/dev/null 2>&1 || { echo "FAIL $g"; node "$g" 2>&1 | tail -5; fail=$((fail+1)); }; done
node scripts/check-evidence-immutability.mjs --base origin/docs/replatform-program || fail=$((fail+1)); echo "failures: $fail"
```
- **LF only.** Write files through Python with `io.open(..., newline='')` and assert there is no `\r`,
  or use the Write/Edit tools.
- Bash heredocs break on backticks and long markdown. Write longer content to a file first, then commit with `-F`.
- In Git Bash, prefix `git show rev:path` commands with `MSYS_NO_PATHCONV=1`.
- `$TMPDIR` is unset. Use your worktree or the scratchpad path you were given.

## Hard limits
- Never dispatch any `keyed-*` workflow or any workflow that spends E2B money.
- Never paste secrets, tokens or unredacted logs into `docs/replatform/`.
- Never use a bare `git stash`.
- If you hit something that needs a decision beyond your unit's brief, STOP and report it. Do not guess.
- **M1 is MULTI-TENANT (founder ruling F10).** Never write anything that assumes a single Organization.

## Final report (your last message)
Include:
- the PR number and head sha;
- the Codex status on that head, and the `ci-required` result;
- a list of what you changed;
- anything you verified that contradicts the plan;
- anything you had to stop on.
Keep it at 400 words or fewer.

## Guard ordering: `git add` → guards → commit (added 2026-09-24)

"Run the full guard set before every push" has a **blind spot for newly-added files**, and it shipped
a stray `scripts/.amend.py` into a commit before anyone noticed.

The cause: several guards walk **tracked** files (`check-invisible-control-chars` among them). An
untracked file is invisible to them, so a pre-commit guard run on a working tree containing a new
file reports `failures: 0` about a tree that does not include it. The guard was correct; it was asked
the wrong question.

**So the order is `git add -A` → run the guards → commit.** Staging first is what makes a new file
visible to a tracked-file walk. The guard caught this one the instant it was staged, which is
default-deny working as designed — it only ever looked late.

Two corollaries:
- **`git status` before you commit**, and read it. A scratch script, an editor backup or a `.orig`
  from a merge is the common case, and none of them belong in a PR.
- A cleanup that depends on the command succeeding (`python x.py && rm x.py`) **does not run when the
  script raises**. Prefer a scratchpad path outside the repo for throwaway scripts, so the cleanup
  never has to work.
