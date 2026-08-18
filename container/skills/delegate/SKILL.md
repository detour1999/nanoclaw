---
name: delegate
description: Delegate a task to a sub-agent with proper attribution, then schedule a self-check follow-up with progressive backoff. Use whenever you assign work to Hal, Jo, Wes, Rando, or any other agent and need to track completion.
---

# delegate

Use this whenever you're farming work out to a sub-agent and need to track completion.

## Step 1: Send the Task

Schedule a task for the sub-agent. Prefix the prompt with "From [YourName]:" so they can display attribution.
Include ALL context they need — they run isolated with no memory of your conversation.

```
mcp__nanoclaw__schedule_task(
  prompt="From [You]: [clear task with full context. What you need, by when, and what to do when done]",
  schedule_type="once",
  schedule_value="[next minute, e.g. 2026-07-31T14:01:00]",
  target_group_jid="[agent JID from org.md]",
  context_mode="isolated"
)
```

## Step 2: Schedule a Self-Check

Immediately after, schedule a follow-up in YOUR OWN group to check for completion.
Pass all state forward in the prompt — you'll have no memory when it fires.

```
mcp__nanoclaw__schedule_task(
  prompt="Self-check: I delegated [task summary] to [Agent] at [time].
Read their recent messages: mcp__nanoclaw__get_messages(folder='[folder]', limit=20)
- If done: [what to do next]
- If not done yet and < 70min elapsed: schedule another check in [2x minutes]
- If no response after ~70min total: re-send the task with 'Following up on my earlier request:'
State: [anything needed to continue the workflow]",
  schedule_type="once",
  schedule_value="[now + 10 minutes]",
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
- On re-prompt, add context: "I asked you X earlier and haven't heard back"
- Once the task is confirmed done, cancel remaining scheduled checks if any
