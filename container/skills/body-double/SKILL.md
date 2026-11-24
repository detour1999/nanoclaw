---
name: body-double
description: Use when the user wants company while working — "sit with me while I do this", "I can't make myself do it alone", "keep me on track", asking for a focused working session with check-ins.
---

# Body Double

## What this is for

Body doubling: working better when someone shares the space. Another presence — even without interaction — helps the ADHD brain sustain focus. This skill runs a session with real, timed check-ins.

## The hard constraint

You only speak when something wakes you. A check-in you promise but can't deliver is worse than none — the user waits on it and loses trust.

So every check-in must be backed by a real timer: `mcp__nanoclaw__schedule_task` with `schedule_type: "once"`, `context_mode: "group"`, and a local timestamp computed from `date` (no Z suffix). The task prompt must carry the context you'll need when it fires — the task, which check-in this is, and when the session ends (e.g. "Body-double check-in 2 of 3 for: <task>. Session ends 3:40."). When it fires you're re-invoked and send the check-in. One timer per check-in; the last one marks the end of the session. Schedule each timer when you send the previous check-in, whether or not they reply. If they end the session early, `cancel_task` the pending timer.

If you have no way to schedule a wake-up, say so in the opening and hand the clock to them: "I can't ping you — set a timer for 25 and message me when it goes off."

## How to run it

Needs: the task and the session length. Ask only for what the invocation didn't give.

### Opening

One line confirming the task and when check-ins land, then start the timer, then: "I'm here. Go."

Intervals:
- Under 30 min: one check-in at the halfway point
- 30-60 min: every 20-25 minutes
- Over 60 min: every 25-30 minutes, choosing an interval that divides the session evenly; at the check-in nearest 60 minutes, suggest a 5-minute break (the clock keeps running)

### Check-ins

One question: "How's it going?"
- Working → "Keep going."
- No reply → nothing. Silence means they're working.
- Stuck → use the start skill on the thing they're stuck on.
- Drifted → "You drifted. What's the next action?"

No conversation during check-ins.

### If they message between check-ins

Answer briefly and send them back to work. Don't reset or cancel the timer.

### Closing

When the last timer fires: "Time. What did you get done?" Then make the win visible: "You did [X] in [time]. That's real." Then: "Keep going or stop here?"

## What not to do

- Do not promise a check-in without a timer behind it.
- Do not give the user a plan for the session — they named the task; that's the plan.
- Do not ask questions that need thought mid-session.
- Do not end without naming what got done.
