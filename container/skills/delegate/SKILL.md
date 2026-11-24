---
name: delegate
description: Hand off work and track it to completion — attribution, then a self-check follow-up with progressive backoff. Use whenever you hand work to anyone else (another NanoClaw agent via schedule_task with target_group_jid, or a coding agent running in a terminal pane), and whenever you tell Dylan you'll check back or let him know when something is done. Not for recurring tasks you schedule for yourself.
---

# delegate

Use this whenever work leaves your hands and you're on the hook for the outcome — farming a task out to another agent, driving a coding agent in a pane, or telling Dylan "I'll let you know when it's done."

## Step 1: Send the Task

### To another NanoClaw agent

Schedule a task for them. Prefix the prompt with "From [YourName]:" so they can display attribution (their `receive-delegation` skill keys on it).
Include ALL context they need — they run isolated with no memory of your conversation.

```
mcp__nanoclaw__schedule_task(
  prompt="From [You]: [clear task with full context. What you need, by when, and what to do when done]",
  schedule_type="once",
  schedule_value="[next minute, local time, e.g. 2026-07-31T14:01:00]",
  target_group_jid="[agent JID from org.md]",
  context_mode="isolated"
)
```

### To a coding agent in a terminal pane

There's no group to schedule into. Send the prompt with whatever drives that pane (Herdr or tmux), then read the pane back to confirm it was accepted — not sitting in the input box, and not landed in a bare shell because the agent had exited. Then go straight to Step 2; the self-check reads the pane instead of `get_messages`.

## Step 2: Schedule a Self-Check

Immediately after, schedule a follow-up in YOUR OWN group to check for completion.
Pass all state forward in the prompt — you'll have no memory when it fires.

```
mcp__nanoclaw__schedule_task(
  prompt="Self-check: I delegated [task summary] to [Agent or pane] at [time].
Check: mcp__nanoclaw__get_messages(folder='[folder]', limit=20)  — or read the pane
- If done: [what to do next — and if I promised Dylan an update, send it now]
- If not done yet and < 70min elapsed: schedule another check in [2x minutes]
- If no response after ~70min total: re-send the task with 'Following up on my earlier request:'
State: [anything needed to continue the workflow]",
  schedule_type="once",
  schedule_value="[now + 10 minutes, local time]",
  context_mode="isolated"
)
```

## Backoff Schedule

| Check | Delay | Total elapsed |
|-------|-------|---------------|
| 1st   | 10 min | 10 min |
| 2nd   | 20 min | 30 min |
| 3rd   | 40 min | 70 min |
| Re-prompt | — | ~70 min |

## Key Rules

- Always carry state forward in the self-check prompt (it runs isolated)
- Read the clock (`date`) before setting `schedule_value`. It is local time with no `Z`; a time in the past is a bug, not a shortcut
- Never put a secret value in a task prompt. Prompts are stored in the database and in session logs. Pass a 1Password reference or say where the secret lives
- If you told Dylan you'd follow up, the follow-up is yours to send. Report the actual outcome, including when it failed or differs from what was asked
- On re-prompt, add context: "I asked you X earlier and haven't heard back"
- Once the task is confirmed done, cancel remaining scheduled checks if any
