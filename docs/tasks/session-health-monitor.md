---
name: session-health-monitor
schedule_type: cron
schedule_value: "*/10 * * * *"
context_mode: isolated
requires_host_access: true
vars:
  agent_name: Reed
  user_name: Dylan
  collector_path: ~/work/tools/fred-tools/tmux_collector.py
---

# Session Health Monitor

A scheduled task that watches every `claude` pane on the host for rate limits and auth failures, notifies the user once per incident, and **auto-restarts panes after the rate limit resets** so nobody has to babysit.

## What it does

1. **Rate limits** — when a pane shows `"You've hit your limit · resets <time>"`:
   - Notify the user once with the reset time
   - Schedule a one-shot restart task for `reset_time + 1 minute` so the pane resumes on its own
   - Track the pane in state so we don't double-notify
2. **Auth failures (401s)** — when 2+ panes show `401` / `Authentication error` / `Unauthorized`:
   - Treat as a platform-wide outage, message the user once
   - When 401s clear, reset the outage flag

## Requirements

- Target group must have `containerConfig.hostAccess: true` (so it can run `ssh_localhost`).
- The [`fred-tools`](https://github.com/2389-research/fred-tools) tmux collector installed at the path in `vars.collector_path`.
- A workspace folder reachable inside the container at `/workspace/group/` (NanoClaw mounts this automatically per group).

## State file

Lives at `/workspace/group/session-health-state.json`. Created on first run if missing.

```json
{
  "rate_limits": {
    "session:window": { "reset_at": "2026-04-07T15:32:00Z", "notified": true }
  },
  "outage_notified": false,
  "outage_first_seen": null
}
```

## Variables

| Var | Default | What it does |
|---|---|---|
| `agent_name` | `Reed` | Who the agent is, used in the prompt's voice |
| `user_name` | `Dylan` | Who the agent reports to |
| `collector_path` | `~/work/tools/fred-tools/tmux_collector.py` | Where the tmux collector lives on the host |

Override at install time via `install_task`'s `vars_override`.

## Why "isolated" context

Each run is a fresh check — there's no need to carry the previous run's conversation. Isolated keeps the prompt deterministic and the token cost flat.

## Prompt

```text
You are {{agent_name}}, {{user_name}}'s work agent. This is your session health monitor run.

## CRITICAL OUTPUT RULES
- NEVER produce text output — it goes to {{user_name}}'s chat.
- The ONLY way to notify {{user_name}} is via the `mcp__nanoclaw__send_message` tool.
- If nothing is wrong: call NO tools except what's needed to check panes and update state. Produce zero output.
- If something is wrong: use `mcp__nanoclaw__send_message` once. Nothing else.

## Steps

### 1. Check panes
Run the collector and capture active Claude panes. Look for:
- 401 errors: "401", "Authentication error", "Unauthorized"
- Rate limits: "You've hit your limit · resets"

Use ssh_localhost to run:
  python3 {{collector_path}}

For each window with "claude" in the name:
  tmux capture-pane -t SESSION:WINDOW -p | tail -10

### 2. Load state
Read /workspace/group/session-health-state.json. If missing, use {}.

### 3. Act on findings

401s on 2+ panes (platform outage):
- If outage_notified false: call mcp__nanoclaw__send_message once
- Set outage_notified: true
- If already true: do nothing

401s cleared:
- Reset outage_notified: false

Rate limit hit (new):
- Call mcp__nanoclaw__send_message once with reset time + when the auto-restart will fire
- Schedule a one-shot restart task at reset_time + 1 min using mcp__nanoclaw__schedule_task
- Mark pane as notified in state

Rate-limited pane recovered:
- Remove from state

### 4. Save state
Write updated state to /workspace/group/session-health-state.json.

That's it. No other output.
```
