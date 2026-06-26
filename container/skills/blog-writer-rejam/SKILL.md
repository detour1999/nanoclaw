---
name: blog-writer-rejam
description: Phase 5 escape hatch for the blog-writer skill. Use when one named section of post.md won't crack after free-form edits. Runs a small writer panel (2-4 personas) tuned specifically to that section's problem, synthesizes a replacement, and snapshots the previous version. NOT for "the whole post isn't working" — that means returning to Phase 4.
---

# blog-writer-rejam

Targeted section re-draft for a single stuck section in an existing `post.md`.

## When to use

- One specific named section won't respond to free-form editing in Phase 5
- You've tried at least 2-3 direct edits and they're not landing
- The problem is localized (opening doesn't hook, middle goes flat, closing is weak, one argument isn't landing)

**NOT for:**
- Multiple sections at once — run separately per section
- "The whole post isn't working" — return to Phase 4 and re-run the writer panel
- Style polish or line-edits — handle those directly in Phase 5

## Instructions

1. Name the specific section and state the problem clearly (e.g., "The 'Why This Matters' section reads as defensive rather than confident").
2. Snapshot `post.md` to `/workspace/group/blog-writer/<slug>/history/post-<ISO-timestamp>.md` before making any changes.
3. Generate a small writer panel of 2-4 personas **tuned to this section's specific problem**. These should NOT be the same personas as Phase 4 — select for what's broken here.
4. Dispatch all personas in a **single message** (multiple Agent calls in one block). Each receives:
   - Their persona
   - The stuck section (verbatim)
   - `/workspace/group/blog-writer/<slug>/voice.md`
   - The section's role in the post (what it needs to accomplish)
   - The diagnosed problem

   Instruction: rewrite just this section from your executional taste. No cross-visibility.
5. Each agent writes to `/workspace/group/blog-writer/<slug>/drafts/rejam-<persona-slug>.md`.
6. Read all versions. Pick the best or synthesize. Note what came from where.
7. Replace the stuck section in `post.md` with the result.
8. Append a note to `synthesis.md`: "Section '<name>' re-jammed at <timestamp> — source: <persona or synthesis>."
9. Return to Phase 5 iteration. Present the updated section to Dylan.

## Constraints

- One section per invocation.
- Always snapshot before replacing.
- Dispatch is parallel (single message), never sequential.
- If after re-jam the section still isn't landing, escalate: tell Dylan the section may need structural change and consider returning to Phase 4.
