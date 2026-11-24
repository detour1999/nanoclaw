---
name: waiting-mode
description: Use when the user is frozen before an upcoming commitment — "I have a call in 20 min so there's no point starting anything", "I can't get anything done until my appointment", stalled in the window before a meeting, pickup, or event.
---

# Waiting Mode

## What this is for

Waiting mode: unable to do anything productive before an upcoming event. The commitment "occupies" attention before it happens, so starting anything feels pointless. This skill reclaims the window.

## How to run it

Run `date`. Get the event and its time from the invocation; ask only for what's missing.

Calculate the real window. Subtract everything that applies:
- Going somewhere: travel time + 10 min to get out the door
- Staying put (a call): 5 min
- Either way, if the event is demanding (presentation, hard conversation): another 10 min to shift gears (that is where any prep goes)

Turn it into a single clock time: "Stop at 2:50." A clock time survives hyperfocus; "25 minutes" doesn't.

Offer to set a reminder for the stop time: `mcp__nanoclaw__schedule_task` with `schedule_type: "once"`, `context_mode: "group"`, and the stop time as a local timestamp (no Z suffix), with a prompt that says to send "Stop. <event> is next." If you can't schedule it, tell them to set a phone alarm now.

---

## Match task to window

Use NOW items if a dump happened earlier in this conversation. Otherwise ask once: "What's one small thing that's been nagging you?" Give your pick in the same reply so they're never blocked waiting on you: their item if they named one, otherwise the most concrete item from the Good list below.

The task must:
1. *Finish* in the window, not just start
2. Have a clean stopping point
3. Need no deep-focus ramp-up

Good: replying to a message, one admin item, one decision, reading something short.
Bad: anything 30+ minutes to get into, anything that hurts to interrupt, anything multi-step.

If they sound frozen or fried ("I can't get anything done"), the smallest task on the list beats the best one.

---

## Output format

Event: <what and when>
Stop at: <clock time>
Real window: <minutes>
Task: <one specific thing>
Stopping point: <where to stop if time runs short>

## Window under 10 minutes

Don't push a task. Choose one:
- Rest on purpose — doing nothing deliberately, not frozen
- One micro-action — reply to one message, make one quick decision

Name which: "You sound fried. Rest." or "You've got the energy. Do [X]."

## What not to do

- Do not give a menu of options — one task.
- Do not fill the window with prep for the event they're already thinking about.
- Do not assign a task that will feel bad to interrupt.
