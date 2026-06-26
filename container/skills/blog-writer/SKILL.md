---
name: blog-writer
description: Write a blog post or essay from source materials (files, links, notes). Use when Dylan says "write a blog post", "draft a post about", "help me write up X", "blog this", "essay about". Walks through information gathering, voice profiling, panel-driven outline, parallel draft generation, synthesis, and iterative editing. Not for short-form social posts, marketing copy, technical docs, or cases where Dylan already has a complete draft.
---

# blog-writer

## Overview

Multi-phase blog post authoring with persona panels and active synthesis. Core principle: a single agent writing a post imagines diverse reactions, guesses at voice, and collapses many drafts into the first that sounds right. This skill makes diversity real via independent agents (audience panels for outline, writer panels for drafts) and gates real by stopping for user approval at every phase boundary.

**Working directory:** `/workspace/group/blog-writer/<slug>/`

## The Flow

```
Invocation
  → Phase 0: Context Capture
  → Phase 1: Information Gathering     GATE: approve research.md
  → Phase 2: Voice                     GATE: approve voice.md
  → Phase 3: Outline
      → GATE: approve audience panel
      → Dispatch audience panel (parallel, single message)
      → Manager reconciles + Q/A validation
      → GATE: approve outline.md
  → Phase 4: Drafting
      → GATE: approve writer panel
      → Dispatch writer panel (parallel, single message)
      → Manager synthesizes → post.md
      → GATE: explicit handoff to Dylan
  → Phase 5: Iteration (free-form edits + snapshots)
      → Loop until Dylan says done
  → Done: skill ends at post.md; hosting agent handles publishing
```

Working directory layout (per post):

```
/workspace/group/blog-writer/<slug>/
  context.md
  research.md
  voice.md
  audience-panel.md
  audience-proposals/<persona-slug>.md
  outline.md
  writer-panel.md
  drafts/<persona-slug>.md
  synthesis.md
  post.md                           (NOT final.md)
  history/post-<timestamp>.md       (Phase 5 snapshots)
```

## Phase 0: Context Capture

**Inputs:** the invocation message and any attached files/links.
**Outputs:** `/workspace/group/blog-writer/<slug>/context.md`

1. Derive a `<slug>` from the post goal (kebab-case, 2-5 words). Confirm in one short question.
2. Create `/workspace/group/blog-writer/<slug>/` (and subdirs `audience-proposals/`, `drafts/`, `history/`).
3. Check for `/workspace/group/voice.md`. Note its existence in `context.md` as the voice file pointer; if absent, write `none`.
4. Write `context.md` with:
   - **Post goal** — one-sentence statement (use Dylan's words where possible)
   - **Inputs registry** — bulleted list of all source materials with one-line descriptions
   - **Voice file pointer** — path or `none`
5. Read `context.md` back. Confirm the post goal.

**Gate:** Dylan confirms post goal and inputs registry before proceeding.

## Phase 1: Information Gathering

**Inputs:** `context.md`, all source materials.
**Outputs:** `/workspace/group/blog-writer/<slug>/research.md`

1. Read every file and fetch every link in the inputs registry.
2. Extract: **Entities** (people, projects, tools, companies), **Claims** (load-bearing assertions), **Quotes** (worth preserving verbatim), **Open threads** (questions materials raise but don't answer).
3. Run a one-question-at-a-time interview to fill gaps. Multi-choice when possible. Stop when: thesis is clear, audience is clear, stance toward any opposed sources is locatable, no source-material gaps remain. Three to five questions is typical.
4. Use `Skill("blog-writer-research")` ONLY if Dylan articulates a specific named factual gap (e.g., "what was the exact date of X?"). NOT for background or "improve the research."
5. Write `research.md` with sections: Post goal, Audience, Thesis or frame, Entities, Claims, Quotes, Open threads, Externally-sourced appendix (if `blog-writer-research` was used).

   **Thesis or frame:** argumentative posts get a single-sentence thesis. Lessons-learned, operational, how-to posts often get a *frame* — a single-sentence orienting claim plus structured lessons/steps. Pick the form the content wants.

**Gate:** present `research.md`. Ask: "Does this capture the post's substance? What's missing or wrong?" Wait for explicit approval.

## Phase 2: Voice

**Inputs:** `research.md`, voice file or writing samples.
**Outputs:** `/workspace/group/blog-writer/<slug>/voice.md`

**Path A — `/workspace/group/voice.md` exists (noted in context.md):**
1. Copy it into the slug directory as `voice.md`.
2. One freshness check: "Anything shifted since this was written, or specific to this post's mode?" Append short addendum if needed.

**Path B — no voice file:**
1. Ask for 2-4 writing samples (links to existing posts, files, or pasted text). If no published samples, use drafts, long emails, Slack threads. Note under "Baseline confidence": "Sketch only — voice baseline is thin; iterate voice.md as more samples emerge."
   - Thin-samples regime (fewer than 3): run 5-8 A/B pairs covering at least one pair per dimension the post needs that the samples don't cover.
2. Read every sample. Note patterns: register, sentence-length variance, paragraph shape, hedging vs assertion, abstract vs concrete, list-vs-prose, metaphor, irony tolerance, em-dash patterns, characteristic words.
3. One open-ended question: "Who do you imagine reading this, and what do they already know?"
4. Run A/B forced-choice calibration for voice dimensions the samples are ambiguous on (see Voice Extraction section).
5. Write `voice.md` with sections: Audience, Register, Sentence/paragraph shape, Stance (hedging/assertion), Concrete/abstract leaning, Structural preferences, Characteristic vocabulary, Anti-patterns.

**Gate:** present `voice.md`. Ask: "Does this read like you? What's off?" Wait for explicit approval.

## Phase 3: Outline

**Inputs:** `research.md`, `voice.md`.
**Outputs:** `audience-panel.md`, `audience-proposals/<persona-slug>.md` per persona, `outline.md`

1. Generate an **audience panel** of 3-5 personas tuned to this post's audience and content. Personas are *readers* — people who might encounter the post in the wild. Each has: Name, 1-2 sentence worldview, optimization function (what they value in a post), relevance hook.
2. Write `audience-panel.md`.
3. **GATE:** present the panel. Dylan can add, remove, swap personas. Wait for explicit approval. Never auto-dispatch.
4. Dispatch all panel agents in a **single message** (multiple `Agent` calls in one block). Each receives: their persona, `research.md`, the post goal. Instruction: react — what lands, what bounces, what they want more of, what they'd skip. No cross-visibility.
5. Each agent writes to `audience-proposals/<persona-slug>.md`.
6. Manager (you) reads all proposals, reconciles into a draft outline + thesis. Surface tensions explicitly ("A wants more X, B finds X tangential — resolving for X because...").
7. **Q/A validation round.** One-question-at-a-time interview to resolve contested decisions from synthesis and validate the thesis. Ask the thesis directly at least once ("Synthesis lands on: '...' — does that say what you want?"). Example: "Two reactions disagreed on whether to lead with framing or example. Pick: (a) framing, (b) example, (c) something else."
8. Write `outline.md` with: Thesis, Sections (titled, 1-3 bullets each), Open questions resolved during synthesis.

**Gate:** Q/A validation must complete before presenting the outline. Then present `outline.md` and wait for explicit approval.

## Phase 4: Drafting

**Inputs:** `research.md`, `voice.md`, `outline.md`.
**Outputs:** `writer-panel.md`, `drafts/<persona-slug>.md` per persona, `synthesis.md`, `post.md`

1. Generate a **writer panel** of 3-5 personas tuned to this post's mode (technical opinion, lessons-learned, contrarian take, etc.). Personas are *writers* with distinct executional taste. Each has: Name, 1-2 sentence worldview/writing philosophy, optimization function, relevance hook.
2. Write `writer-panel.md`.
3. **GATE:** present the panel. Wait for explicit approval. Never auto-dispatch.
4. Dispatch all writer-panel agents in a **single message**. Each receives: their persona, `voice.md`, `outline.md`, `research.md`, the post goal. Instruction: write a complete draft (not outline, not sketch) inside this persona's executional taste while honoring `voice.md` and `outline.md`. No cross-visibility.

   Example (one message, multiple Agent calls):
   ```
   Agent("You are Marina, skeptical practitioner. [worldview...]
         Read /workspace/group/blog-writer/<slug>/research.md, voice.md, outline.md.
         Write a complete draft honoring voice.md from YOUR executional taste.
         Write to /workspace/group/blog-writer/<slug>/drafts/marina.md.")
   Agent("You are Jordan, the storyteller. [...] -> drafts/jordan.md")
   Agent("You are Alex, engineer-who-hates-fluff. [...] -> drafts/alex.md")
   ```

5. Each agent writes to `drafts/<persona-slug>.md`.
6. **Synthesis (active, not a backlog):** read all drafts. Pick the strongest as base. For every losing draft, identify specific strengths (better opening, tighter middle, sharper closing, vivid example) and fold them in now. Write `synthesis.md` (table: source → fragment → destination). Result goes to `post.md`.
7. Read `post.md` end-to-end. Confirm it honors `voice.md` and `outline.md`. Append "Known voice drift" section to `synthesis.md` for any places synthesis pulled voice off-axis.

**Gate:** present `post.md` with explicit handoff: "Here's the synthesized draft. Read it through — what works, what doesn't, what's missing?" Do NOT slide into Phase 5 silently.

## Phase 5: Iteration

**Inputs:** `post.md` and everything that produced it.
**Outputs:** updated `post.md`, `history/post-<timestamp>.md` snapshots.

1. Ask: "Read it. What's working, what's not?"
2. Conversation flows free-form. Feedback in any shape.
3. Make targeted edits to `post.md` directly.
4. **Before substantial revisions** (>~20% of the post, or any whole-section rewrite), snapshot `post.md` to `history/post-<ISO-timestamp>.md`.
5. If one section won't crack after free-form edits, use `Skill("blog-writer-rejam")` for just that section. Don't re-run the whole writer panel for one stuck section.
6. Loop. Dylan signals done when ready ("done", "I'll take it from here", "ship it").

**On completion:** the skill ends at `post.md`. Notify Dylan the draft is ready. The hosting agent handles publishing (PR creation, git workflow, etc.) according to its own workflow.

## Panel Mechanics

**Load-bearing pattern of the skill. Read carefully.**

### Persona generation

- 3-5 personas per panel. Four is the sweet spot.
- **Domain-tuned every time.** Generate from this post's content, audience, and mode. Never reach for hardcoded archetypes.
- Audience-panel personas are *readers* — reactions, not drafts.
- Writer-panel personas are *writers* — executional taste, not reactions.
- Each persona has: **name**, **1-2 sentence worldview**, **optimization function**, **relevance hook**.
- Personas must produce **genuine disagreement**, not polite variations.
- **At least one persona must disagree with the post's framing or premise**, not just its execution.

### Single-message dispatch

All panel agents dispatched in **one message**, multiple `Agent` calls in the same block. Sequential breaks independence — even with no shared text, the second agent's context has been touched.

### Independence

Panel agents must have no visibility into each other's output. Each receives only its persona, the shared inputs the phase calls for, and the post goal.

### Synthesis is active

1. Pick the strongest draft as the base.
2. For each other draft, identify concrete strengths (a phrase, an opening, a structural move).
3. **Fold those strengths into the base now**, in `post.md`.
4. Record what came from where in `synthesis.md`.

There is no later. Fold in now, or decide it doesn't fit and move on.

## Voice Extraction

**Samples are ground truth.** A/B calibration only fills gaps the samples don't resolve.

### Why A/B forced-choice

Writers describe their voice aspirationally. Forced-choice between concrete fragments triangulates actual preference.

### Mechanics

1. Read every sample fully before asking anything.
2. Identify dimensions samples are ambiguous on.
3. For each ambiguous dimension, construct a forced-choice pair. Two short fragments, A and B: "Which feels more like you?"
4. Allow a third option: "Neither — closer to: ___"
5. One pair per question. Never batch.

### Example A/B pair shapes (write fresh ones from actual samples)

- **Register:** A: "The way I see it, the system is broken." / B: "System's broken."
- **Sentence length:** A: "Durability costs you up front, and pays back over a horizon you can't predict, which is why most teams skip it." / B: "Durability costs up front. It pays back over a horizon you can't predict. Most teams skip it."
- **Hedging vs assertion:** A: "It seems like one possible reading is that retention has plateaued." / B: "Retention has plateaued."
- **Abstract vs concrete:** A: "Many systems exhibit fragility at scale due to subsystem coupling." / B: "Last Tuesday, auth took down checkout because they share a Redis instance."

### Anti-patterns from samples + A/B, never self-report

After samples are read and A/B is run, list anti-patterns voice actively rejects. Sources:
- Tells the samples don't exhibit (em-dash-as-comma overuse, rule-of-three lists, "it's not just X, it's Y", delve/leverage/comprehensive)
- A/B choices that consistently picked more direct/concrete options

**Never** generate the anti-pattern list from "what do you dislike?"

## Red Flags — STOP and Adjust

- **"I'll dispatch panel agents one at a time, same result."** NO. Single-message parallel dispatch. Sequential breaks independence.
- **"I'll reuse persona archetypes from a past panel."** NO. Domain-tuned to THIS post every time.
- **"My panel agrees on the framing."** NO. Sharpen at least one persona to attack the post's premise.
- **"I have the samples, I don't need a voice file."** NO. Drafting agents need a digested profile, not raw samples.
- **"I'll skip the panel-approval gate."** NO. The gate is Dylan's chance to swap personas before dispatch.
- **"Losing drafts have nothing useful."** NO. Read every losing draft for concrete strengths.
- **"I'll note losing-draft strengths in synthesis.md for later."** NO. There is no later. Fold in now or drop.
- **"I'll batch the voice questions."** NO. One at a time, multi-choice when possible.
- **"I'll use blog-writer-research for background context."** NO. Named factual gaps only.
- **"The whole post isn't working — I'll re-jam each section."** NO. If the whole post is broken, return to Phase 4.
- **"Contested decisions are minor — skip the Q/A round."** NO. Q/A surfaces thesis tensions; skipping smuggles them into the draft.

## Critical Rules

1. **Dispatch ALL panel agents in a single message.** Sequential breaks independence.
2. **Personas are domain-tuned to this post.** Never hardcoded templates.
3. **Voice samples are ground truth; A/B calibration only fills gaps.**
4. **Synthesis is active.** Fold strengths from losing drafts into `post.md` immediately. No backlog.
5. **Gate every phase with explicit user approval.** Phase 4 includes an explicit handoff before iteration.
6. **One question at a time in interviews.** Multi-choice when possible. Never batched.
7. **Working draft is `post.md`, not `final.md`.** Snapshot to `history/` before substantial revisions.
8. **Anti-AI patterns belong in `voice.md`, not a post-hoc humanizer pass.**
9. **The skill ends at `post.md`.** Publishing is the hosting agent's job.
