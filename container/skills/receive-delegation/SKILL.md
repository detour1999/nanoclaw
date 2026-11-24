---
name: receive-delegation
description: Handle work handed to you by another agent or relayed on someone's behalf. Use when your prompt begins "From <name>:" or "Task from <name>", or says it is relayed (e.g. "Direction from Dylan (relayed via …)"). Opens with an attribution header so Dylan can see who sent what, does the work, then reports back. Not for your own recurring scheduled tasks.
---

# receive-delegation

When your task prompt starts with "From [Agent]:" or "Task from [Agent]", or says it's relayed on someone's behalf. Your own recurring scheduled tasks don't count, even though they also arrive as scheduled tasks.

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

Report what actually happened. If you couldn't finish, something was blocked, or the result differs from what was asked, say so plainly. The sender's self-check reads your report as the truth.
