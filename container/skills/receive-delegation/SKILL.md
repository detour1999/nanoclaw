---
name: receive-delegation
description: Handle a task delegated from another agent (Mo, Fred, Reed). Opens with an attribution header so Dylan can see who sent what, does the work, then reports back. Invoke at the start of any task that appears to come from another agent rather than Dylan directly.
---

# receive-delegation

When your task prompt starts with "From [Agent]:" or is clearly a scheduled task from the org (not Dylan typing directly):

## Step 1: Attribution Header

**Always** open your response with:

> **Request from [Agent]:** [one-sentence summary of what was asked]

This lets Dylan see at a glance in your chat who asked for what and why you're doing it. Don't skip it.

## Step 2: Do the Work

Proceed normally. Use your tools, do the task, be thorough.

## Step 3: Save Progress (if multi-step)

If this is part of a longer workflow, save state to your workspace so a follow-up can continue.
Write a brief `status.md` or append to a work log so the coordinator's self-check can confirm completion.

## What "Reports Back" Means

Your response IS the report-back — it appears in your chat and the coordinator will read it via `get_messages`.
You don't need to schedule anything back unless explicitly asked to.
