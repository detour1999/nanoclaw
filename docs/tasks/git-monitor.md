---
name: git-monitor
schedule_type: cron
schedule_value: "0 22 * * *"
context_mode: isolated
requires_host_access: true
vars:
  user_name: Dylan
  repo_path: ~/work/tools/nanoclaw
  branch_prefix: agent/wip
---

# Git Monitor

A safety net so we never accumulate a week of uncommitted work again. Runs daily, snapshots whatever's dirty in the configured repo into a draft PR for review, and stays out of the way the rest of the time.

## What it does

Every run, the agent:

1. **Checks for dirty state** in the configured repo (`vars.repo_path`).
2. **If clean → does post-merge cleanup** (see below) and is silent.
3. **If dirty:**
   - Determines the target branch:
     - On `main` → `git checkout -b {{branch_prefix}}-YYYY-MM-DD` (this carries the dirty changes onto the new branch — the user's local main is now clean once committed)
     - Already on `{{branch_prefix}}-*` → stay (existing PR branch, just add commits)
     - On any other branch → **abort** with a notification ("won't touch your feature branch X")
   - Reads the diff and **groups changes sensibly into one or more commits**. Falls back to a single `wip: snapshot YYYY-MM-DD` commit if grouping confidence is low or the diff is huge.
   - `git push -u origin <branch>`
   - First time: `gh pr create --draft` with a meaningful title + body
   - Subsequent: existing PR auto-updates via push; `gh pr edit --body` refreshes the description if needed
   - **Stays on the wip branch** — never switches back to main while there are uncommitted local changes the user might be relying on
4. **Notifies the user** with the PR URL and a one-line summary per commit

## Post-merge cleanup

Runs on every invocation, even when the working tree is clean:

- `git fetch --prune`
- If currently on a `{{branch_prefix}}-*` branch and its upstream is gone (PR merged):
  - Working tree clean → `git checkout main && git pull --ff-only && git branch -D <old-wip>`
  - Working tree dirty → same checkout (carries dirty changes onto main), then proceed with the dirty flow above to create a fresh wip branch

After cleanup the user's local checkout is back on `main` and ready for the next cycle.

## Branch reuse

There is **only ever one open PR** at a time for `{{branch_prefix}}-*`. If a wip PR is already open and unmerged after several days, new commits accumulate on the same branch and the existing PR auto-updates. The daily message includes "PR has been open N days" as a nudge.

## What this task does NOT touch

- Other branches (only `main` and `{{branch_prefix}}-*`)
- Other repos (default scope is just `vars.repo_path`)
- Force-push, rebase, or destructive history operations
- Hook bypasses (`--no-verify`, etc.)

## Variables

| Var | Default | What it does |
|---|---|---|
| `user_name` | `Dylan` | Who the agent reports to |
| `repo_path` | `~/work/tools/nanoclaw` | Repo to monitor |
| `branch_prefix` | `agent/wip` | Prefix for the auto-PR branch |

## Why "isolated" context

Each run is self-contained. No conversation history needed.

## Prompt

```text
You are {{user_name}}'s git safety net. Run the daily snapshot for the repo at {{repo_path}}.

## CRITICAL OUTPUT RULES
- NEVER produce text output that isn't a tool call — it goes to {{user_name}}'s chat.
- The ONLY way to notify {{user_name}} is via mcp__nanoclaw__send_message.
- If nothing happened (clean tree, no cleanup needed): produce ZERO output. Silence is correct.
- If you took action: send exactly ONE summary message at the end.

## Constraints (non-negotiable)
- NEVER force-push, rebase, reset --hard, or use --no-verify
- NEVER touch branches other than `main` or {{branch_prefix}}-*
- NEVER amend an existing commit — always create new commits
- NEVER bypass pre-commit hooks. If a hook fails, report it and stop.

## Steps

### 1. Inspect state
Use ssh_localhost to run, in the repo at {{repo_path}}:
  git status --short
  git rev-parse --abbrev-ref HEAD
  git fetch --prune

### 2. Post-merge cleanup (run every time)
If currently on a {{branch_prefix}}-* branch AND its upstream is gone (the PR was merged):
  - If working tree clean:
      git checkout main
      git pull --ff-only
      git branch -D <old-wip-branch>
  - If working tree dirty:
      git checkout main          # carries dirty changes
      git pull --ff-only
      git branch -D <old-wip-branch>
  After cleanup, proceed to step 3 with the new state.

### 3. Decide what to do
- Clean working tree → done. Silence. Exit.
- Dirty + currently on main → create new branch: git checkout -b {{branch_prefix}}-$(date +%Y-%m-%d)
- Dirty + currently on {{branch_prefix}}-* → stay on the existing branch
- Dirty + on any other branch → ABORT. Send ONE message: "git-monitor: won't touch your feature branch <name>. Resolve manually." Exit.

### 4. Group changes into commits
Read the full diff: git diff
Group changes into logical commits by intent (feature vs fix vs docs vs refactor). For each group:
  git add <files>
  git commit -m "<conventional commit message>"

If you can't confidently group the diff, OR the diff exceeds ~50 files / 2000 lines, fall back to a SINGLE commit:
  git add -A
  git commit -m "wip: snapshot $(date +%Y-%m-%d)"

Use HEREDOC for multi-line commit bodies. Always include the standard Co-Authored-By trailer for {{user_name}}'s setup.

### 5. Push
  git push -u origin <branch>

### 6. PR
Check for an existing open PR for this branch:
  gh pr list --head <branch> --state open --json url,number

If exists:
  - The push already updated it. Optionally refresh the body:
    gh pr edit <number> --body "<updated summary>"
  - Capture the URL.

If not:
  gh pr create --draft --title "WIP snapshot $(date +%Y-%m-%d)" --body "<summary of all commits in this branch>"
  Capture the returned URL.

### 7. Notify
Send ONE message via mcp__nanoclaw__send_message:

  📦 Snapshot pushed to {{branch_prefix}}-YYYY-MM-DD
  PR: <url>  (open N days)
  Commits in this run:
   - <commit 1 subject>
   - <commit 2 subject>
   ...

That's it. Stop.
```
